# frozen_string_literal: true

require "rails_helper"

RSpec.describe Ai::AnthropicClient do
  before { Metrics::Recorder.reset! }
  after  { Metrics::Recorder.reset! }

  describe ".client" do
    before do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("ANTHROPIC_API_KEY").and_return("test-key")
    end

    it "constructs Anthropic::Client with default timeout/retries" do
      expect(Anthropic::Client).to receive(:new).with(
        api_key:     "test-key",
        timeout:     described_class::DEFAULT_TIMEOUT_SECONDS,
        max_retries: described_class::DEFAULT_MAX_RETRIES,
      ).and_return(:client_double)

      expect(described_class.client).to eq(:client_double)
    end

    it "passes through caller-supplied timeout and max_retries" do
      expect(Anthropic::Client).to receive(:new).with(
        api_key:     "test-key",
        timeout:     5,
        max_retries: 0,
      ).and_return(:client_double)

      described_class.client(timeout: 5, max_retries: 0)
    end

    it "raises KeyError when ANTHROPIC_API_KEY is missing" do
      allow(ENV).to receive(:fetch).with("ANTHROPIC_API_KEY").and_raise(KeyError)
      expect { described_class.client }.to raise_error(KeyError)
    end
  end

  describe ".messages_create" do
    let(:usage_double) { double("usage", input_tokens: 120, output_tokens: 80) }
    let(:response_double) { double("response", content: [], usage: usage_double) }
    let(:messages_double) { double("messages", create: response_double) }
    let(:client_double)   { double("client", messages: messages_double) }

    it "delegates to client.messages.create with model + kwargs and returns the response" do
      expect(messages_double).to receive(:create).with(
        model:      "claude-haiku-4-5",
        max_tokens: 256,
        messages:   [{ role: "user", content: "hi" }],
      ).and_return(response_double)

      result = described_class.messages_create(
        service:    "task_filter",
        model:      "claude-haiku-4-5",
        client:     client_double,
        max_tokens: 256,
        messages:   [{ role: "user", content: "hi" }],
      )

      expect(result).to eq(response_double)
    end

    it "records duration, tokens, and estimated cost on success" do
      described_class.messages_create(
        service: "task_filter",
        model:   "claude-haiku-4-5",
        client:  client_double,
      )

      Metrics::Recorder.snapshot!

      usage_status = OperationalStatus.find_by(category: "metrics", key: "ai_usage")
      expect(usage_status).to be_present
      service_payload = usage_status.payload["services"].find { |s| s["service"] == "task_filter" }
      expect(service_payload).to be_present
      expect(service_payload["total_calls"]).to eq(1)
      expect(service_payload["success_calls"]).to eq(1)
      expect(service_payload["total_input_tokens"]).to eq(120)
      expect(service_payload["total_output_tokens"]).to eq(80)
      expect(service_payload["total_tokens"]).to eq(200)
      # Haiku 4.5: $1/MTok input, $5/MTok output → 120e-6 * 1 + 80e-6 * 5 = 0.00052
      expect(service_payload["total_cost_usd"]).to be_within(1e-9).of(0.00052)

      latency_status = OperationalStatus.find_by(category: "metrics", key: "ai_response_times")
      expect(latency_status.payload["services"].find { |s| s["service"] == "task_filter" }["count"]).to eq(1)
    end

    it "normalises dated model IDs for pricing" do
      described_class.messages_create(
        service: "task_filter",
        model:   "claude-haiku-4-5-20251001",
        client:  client_double,
      )
      Metrics::Recorder.snapshot!

      usage = OperationalStatus.find_by(category: "metrics", key: "ai_usage")
      svc   = usage.payload["services"].find { |s| s["service"] == "task_filter" }
      # Same as the alias — dated suffix should not zero out the cost.
      expect(svc["total_cost_usd"]).to be_within(1e-9).of(0.00052)
    end

    it "reports zero cost (not a fabricated number) for unknown models" do
      described_class.messages_create(
        service: "task_filter",
        model:   "claude-future-99",
        client:  client_double,
      )
      Metrics::Recorder.snapshot!

      svc = OperationalStatus.find_by(category: "metrics", key: "ai_usage").payload["services"].first
      expect(svc["total_cost_usd"]).to eq(0.0)
      expect(svc["total_input_tokens"]).to eq(120) # tokens still captured
    end

    it "records timeout status and re-raises on Anthropic::Errors::APITimeoutError" do
      timeout_error = Anthropic::Errors::APITimeoutError.new(url: URI("https://api.anthropic.com/v1/messages"))
      allow(messages_double).to receive(:create).and_raise(timeout_error)

      expect {
        described_class.messages_create(service: "task_filter", model: "claude-haiku-4-5", client: client_double)
      }.to raise_error(Anthropic::Errors::APITimeoutError)

      Metrics::Recorder.snapshot!
      svc = OperationalStatus.find_by(category: "metrics", key: "ai_usage").payload["services"].first
      expect(svc["timeout_calls"]).to eq(1)
      expect(svc["success_calls"]).to eq(0)
      expect(svc["total_input_tokens"]).to eq(0) # no response, no tokens
    end

    it "records error status and re-raises on Anthropic::Errors::Error" do
      api_error = Anthropic::Errors::APIConnectionError.new(message: "boom", url: URI("https://api.anthropic.com"))
      allow(messages_double).to receive(:create).and_raise(api_error)

      expect {
        described_class.messages_create(service: "task_filter", model: "claude-haiku-4-5", client: client_double)
      }.to raise_error(Anthropic::Errors::Error)

      Metrics::Recorder.snapshot!
      svc = OperationalStatus.find_by(category: "metrics", key: "ai_usage").payload["services"].first
      expect(svc["error_calls"]).to eq(1)
    end

    it "tolerates a response that does not expose .usage (test doubles)" do
      response_without_usage = double("response", content: [])
      allow(messages_double).to receive(:create).and_return(response_without_usage)

      expect {
        described_class.messages_create(service: "task_filter", model: "claude-haiku-4-5", client: client_double)
      }.not_to raise_error

      Metrics::Recorder.snapshot!
      svc = OperationalStatus.find_by(category: "metrics", key: "ai_usage").payload["services"].first
      expect(svc["total_input_tokens"]).to eq(0)
      expect(svc["total_cost_usd"]).to eq(0.0)
    end
  end

  describe ".estimate_cost" do
    it "computes per-mtok cost for known models" do
      cost = described_class.estimate_cost("claude-sonnet-4-6", input_tokens: 1_000_000, output_tokens: 500_000)
      # $3 + $7.50 = $10.50
      expect(cost).to be_within(1e-6).of(10.5)
    end

    it "returns 0.0 for unknown models" do
      expect(described_class.estimate_cost("claude-fictional", input_tokens: 1_000, output_tokens: 1_000)).to eq(0.0)
    end
  end

  describe ".normalize_model" do
    it "strips a YYYYMMDD suffix" do
      expect(described_class.normalize_model("claude-haiku-4-5-20251001")).to eq("claude-haiku-4-5")
    end

    it "leaves alias IDs untouched" do
      expect(described_class.normalize_model("claude-haiku-4-5")).to eq("claude-haiku-4-5")
    end
  end
end
