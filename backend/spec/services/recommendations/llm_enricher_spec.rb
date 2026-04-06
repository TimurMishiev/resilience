require "rails_helper"

RSpec.describe Recommendations::LlmEnricher, type: :service do
  let(:messages_resource) { instance_double(Anthropic::Resources::Messages) }
  let(:client) { instance_double(Anthropic::Client, messages: messages_resource) }
  let(:content_block) { instance_double("Anthropic::TextBlock", text: response_text) }
  let(:response) { instance_double("Anthropic::Message", content: [content_block]) }
  let(:response_text) do
    <<~JSON
      [
        {
          "recommendation_type": "create_task",
          "confidence": 0.82,
          "rationale": "Task creation is warranted due to overlapping alert pressure.",
          "evidence": [{ "type": "site", "id": "site-1", "detail": "Repeated activity" }],
          "action_payload": { "site_id": "site-1", "title": "Inspect corridor" },
          "affected_entity_type": "Site",
          "affected_entity_id": "site-1"
        }
      ]
    JSON
  end
  let(:context) do
    {
      stale_alerts: [],
      high_conf_alerts: [],
      open_incidents: [],
      overdue_tasks: [],
      flaggable_sites: [],
      bulk_triage_sites: [],
      asset_availability: {},
      posture_by_site_id: {},
    }
  end

  before do
    Rails.cache.clear
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:[]).with("ANTHROPIC_API_KEY").and_return("test-key")
    allow(ENV).to receive(:fetch).with("ANTHROPIC_API_KEY").and_return("test-key")
    allow(Anthropic::Client).to receive(:new).and_return(client)
  end

  after do
    Rails.cache.clear
  end

  it "initializes Anthropic with a bounded timeout and no retries" do
    expect(Anthropic::Client).to receive(:new).with(
      api_key: "test-key",
      timeout: described_class::ANTHROPIC_TIMEOUT_SECONDS,
      max_retries: described_class::ANTHROPIC_MAX_RETRIES,
    ).and_return(client)

    allow(messages_resource).to receive(:create).and_return(response)

    result = described_class.call(context: context)

    expect(result).to be_success
  end

  it "calls the Anthropic messages resource via create and returns parsed recommendations" do
    expect(messages_resource).to receive(:create).with(
      hash_including(
        model: described_class::DEFAULT_MODEL,
        max_tokens: described_class::MAX_TOKENS,
        temperature: described_class::TEMPERATURE,
      )
    ).and_return(response)

    result = described_class.call(context: context)

    expect(result).to be_success
    expect(result.payload[:recommendations]).to contain_exactly(
      hash_including(
        recommendation_type: "create_task",
        tier: "llm",
        affected_entity_type: "Site",
        affected_entity_id: "site-1",
      )
    )
  end

  it "allows the recommendation model to be overridden via environment" do
    allow(ENV).to receive(:fetch).with("RECOMMENDATION_LLM_MODEL", described_class::DEFAULT_MODEL).and_return("claude-sonnet-4-5-20250929")

    expect(messages_resource).to receive(:create).with(
      hash_including(model: "claude-sonnet-4-5-20250929"),
    ).and_return(response)

    result = described_class.call(context: context)

    expect(result).to be_success
  end

  it "degrades gracefully and captures observability on timeout" do
    timeout_error = Anthropic::Errors::APITimeoutError.new(url: URI("https://api.anthropic.com/v1/messages"))
    allow(messages_resource).to receive(:create).and_raise(timeout_error)

    expect(Rails.logger).to receive(:error).with(a_string_including("Recommendation enrichment timed out"))
    expect(Observability).to receive(:capture_exception).with(
      timeout_error,
      hash_including(
        tags: include(service: "recommendation_llm_enricher", failure: "timeout"),
        throttle_key: a_string_including("recommendation_llm_enricher:timeout"),
      ),
    )

    result = described_class.call(context: context)

    expect(result).to be_success
    expect(result.payload[:recommendations]).to eq([])
  end

  it "degrades gracefully and captures observability on unexpected errors" do
    error = Anthropic::Errors::APIConnectionError.new(message: "anthropic exploded", url: URI("https://api.anthropic.com"))
    allow(messages_resource).to receive(:create).and_raise(error)

    expect(Rails.logger).to receive(:error).with(a_string_including("Recommendation enrichment error: anthropic exploded"))
    expect(Observability).to receive(:capture_exception).with(
      error,
      hash_including(
        tags: include(service: "recommendation_llm_enricher", failure: "error"),
        throttle_key: a_string_including("recommendation_llm_enricher:error"),
      ),
    )

    result = described_class.call(context: context)

    expect(result).to be_success
    expect(result.payload[:recommendations]).to eq([])
  end

  it "returns an empty array and captures observability when the model returns invalid JSON" do
    bad_response = instance_double("Anthropic::Message", content: [instance_double("Anthropic::TextBlock", text: "{")])
    allow(messages_resource).to receive(:create).and_return(bad_response)

    expect(Rails.logger).to receive(:warn).with(a_string_including("Recommendation enrichment JSON parse failed"))
    expect(Observability).to receive(:capture_exception).with(
      instance_of(JSON::ParserError),
      hash_including(
        tags: include(service: "recommendation_llm_enricher", failure: "parse_error"),
        throttle_key: a_string_including("recommendation_llm_enricher:parse_error"),
      ),
    )

    result = described_class.call(context: context)

    expect(result).to be_success
    expect(result.payload[:recommendations]).to eq([])
  end

  it "opens the breaker after repeated invalid JSON responses" do
    bad_response = instance_double("Anthropic::Message", content: [instance_double("Anthropic::TextBlock", text: "{")])
    allow(messages_resource).to receive(:create).and_return(bad_response)

    Ai::CircuitBreaker::FAILURE_THRESHOLD.times do
      result = described_class.call(context: context)
      expect(result).to be_success
      expect(result.payload[:recommendations]).to eq([])
    end

    expect(Ai::CircuitBreaker.open?(service: described_class::BREAKER_SERVICE)).to be(true)
  end

  it "returns no recommendations when the AI circuit breaker is open" do
    allow(Ai::CircuitBreaker).to receive(:open?).with(service: described_class::BREAKER_SERVICE).and_return(true)
    expect(Anthropic::Client).not_to receive(:new)

    result = described_class.call(context: context)

    expect(result).to be_success
    expect(result.payload[:recommendations]).to eq([])
  end
end
