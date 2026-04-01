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
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:[]).with("ANTHROPIC_API_KEY").and_return("test-key")
    allow(ENV).to receive(:fetch).with("ANTHROPIC_API_KEY").and_return("test-key")
    allow(Anthropic::Client).to receive(:new).with(api_key: "test-key", timeout: 30).and_return(client)
  end

  it "calls the Anthropic messages resource via create and returns parsed recommendations" do
    expect(messages_resource).to receive(:create).with(
      hash_including(
        model: described_class::MODEL,
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
end
