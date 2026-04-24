require "rails_helper"

RSpec.describe Ai::FilterService, type: :service do
  let(:tool_block) { double("tool_block", type: :tool_use, name: described_class::TOOL_NAME, input: tool_input) }
  let(:fake_response) { double("anthropic_response", content: [tool_block]) }
  let(:fake_messages) { double("messages", create: fake_response) }
  let(:fake_client) { double("anthropic_client", messages: fake_messages) }
  let(:user) { create(:user, :commander) }

  before do
    stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_specs"))
    allow(Anthropic::Client).to receive(:new).and_return(fake_client)
  end

  describe "validation" do
    let(:tool_input) { {} }

    it "rejects a blank query" do
      result = described_class.call(user: user, query: "  ")

      expect(result.success).to be(false)
      expect(result.errors).to include("Query cannot be blank")
    end
  end

  describe "planner hardening" do
    let!(:site) { create(:site, name: "Forward Site Alpha") }
    let(:query) { "show high priority tasks at Forward Site Alpha" }
    let(:tool_input) do
      {
        "site_id" => site.id,
        "workflow_status" => "triaged",
        "priority" => "high",
        "created_after" => "2026-03-31T10:00:00Z",
        "created_before" => "2026-04-01T10:00:00Z",
      }
    end

    it "initializes the Anthropic client with a bounded timeout and no retries" do
      expect(Anthropic::Client).to receive(:new).with(
        hash_including(
          api_key: "test_key_for_specs",
          timeout: described_class::ANTHROPIC_TIMEOUT_SECONDS,
          max_retries: described_class::ANTHROPIC_MAX_RETRIES,
        ),
      ).and_return(fake_client)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(true)
    end

    it "allows the filter model to be overridden via environment" do
      stub_const("ENV", ENV.to_h.merge(
        "ANTHROPIC_API_KEY" => "test_key_for_specs",
        "FILTER_MODEL" => "claude-sonnet-4-5-20250929",
      ))

      expect(fake_messages).to receive(:create).with(
        hash_including(model: "claude-sonnet-4-5-20250929"),
      ).and_return(fake_response)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(true)
    end

    it "returns a timeout failure and captures observability" do
      timeout_error = Anthropic::Errors::APITimeoutError.new(url: URI("https://api.anthropic.com/v1/messages"))
      allow(fake_messages).to receive(:create).and_raise(timeout_error)

      expect(Rails.logger).to receive(:error).with(a_string_including("Task filter query timed out", "APITimeoutError"))
      expect(Observability).to receive(:capture_exception).with(
        timeout_error,
        hash_including(
          tags: include(service: "task_filter", failure: "timeout"),
          extra: include(query: query),
          throttle_key: a_string_including("task_filter:timeout"),
        ),
      )

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["Task filter query timed out"])
    end

    it "logs and captures unexpected failures" do
      error = Anthropic::Errors::APIConnectionError.new(message: "planner exploded", url: URI("https://api.anthropic.com"))
      allow(fake_messages).to receive(:create).and_raise(error)

      expect(Rails.logger).to receive(:error).with(a_string_including("AI service error: planner exploded", "Anthropic::Errors::APIConnectionError"))
      expect(Observability).to receive(:capture_exception).with(
        error,
        hash_including(
          tags: include(service: "task_filter", failure: "error"),
          extra: include(query: query),
          throttle_key: a_string_including("task_filter:error"),
        ),
      )

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["AI service error: planner exploded"])
    end

    it "rebuilds the site catalog for new instances so fresh sites are visible immediately" do
      first = described_class.new(user: user, query: "first")
      expect(first.send(:site_catalog).map { |entry| entry[:name] }).to contain_exactly("Forward Site Alpha")

      create(:site, name: "Forward Site Bravo")

      second = described_class.new(user: user, query: "second")
      expect(second.send(:site_catalog).map { |entry| entry[:name] }).to include("Forward Site Alpha", "Forward Site Bravo")
    end

    it "fails closed when the AI circuit breaker is open" do
      allow(Ai::CircuitBreaker).to receive(:open?).with(service: described_class::BREAKER_SERVICE).and_return(true)
      expect(Anthropic::Client).not_to receive(:new)

      result = described_class.call(user: user, query: query)

      expect(result.success).to be(false)
      expect(result.errors).to eq(["AI temporarily unavailable. Please retry shortly."])
    end
  end

  describe "filter validation" do
    let!(:site) { create(:site, name: "Forward Site Alpha") }
    let(:tool_input) do
      {
        "site_id" => "not-a-real-site",
        "workflow_status" => "wrong",
        "priority" => "urgent",
        "created_after" => "not-a-time",
        "created_before" => "2026-04-01T10:00:00Z",
      }
    end

    it "normalizes invalid planner output to safe filter values" do
      result = described_class.call(user: user, query: "filter tasks")

      expect(result.success).to be(true)
      expect(result.payload[:filters]).to eq(
        site_id: nil,
        workflow_status: nil,
        priority: nil,
        created_after: nil,
        created_before: "2026-04-01T10:00:00Z",
      )
    end
  end

  describe "tenant scoping" do
    let(:org) { create(:organization) }
    let(:user) { create(:user, :commander, organization: org) }
    let!(:local_site) { create(:site, name: "Forward Site Alpha", organization: org) }
    let!(:foreign_site) { create(:site, name: "Foreign Site Bravo", organization: create(:organization)) }
    let(:tool_input) do
      {
        "site_id" => foreign_site.id,
        "workflow_status" => "triaged",
        "priority" => "high",
      }
    end

    it "excludes foreign sites from the planner catalog and rejects foreign site ids" do
      tool_payload = nil
      allow(fake_messages).to receive(:create) do |args|
        tool_payload = args[:tools].first
        fake_response
      end

      result = described_class.call(user: user, query: "show high priority tasks at bravo")

      expect(result.success).to be(true)
      expect(result.payload[:filters][:site_id]).to be_nil
      expect(tool_payload.dig(:input_schema, :properties, :site_id, :description)).to include("Forward Site Alpha")
      expect(tool_payload.dig(:input_schema, :properties, :site_id, :description)).not_to include("Foreign Site Bravo")
    end
  end
end
