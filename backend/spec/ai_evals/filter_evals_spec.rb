require "rails_helper"

# AI evaluation harness for Ai::FilterService.
#
# Each eval pins a known-good mapping from (user query, stubbed
# Anthropic tool_use output) to (normalised filter hash). A future
# regression in tool_use parsing, enum validation, or input
# normalisation will fail these specs.
#
# Stub-based — no Anthropic calls. The anthropic_response column
# is what a known-good model call would have returned for the
# user query. The expected column is what the service should
# return after its own validation / normalisation.
#
# See spec/ai_evals/README.md for how to add new evals.
RSpec.describe "AI eval: Ai::FilterService", type: :service do
  let(:commander) { create(:user, :commander) }
  let(:forward_site) { create(:site, name: "Forward Site Alpha") }

  before do
    stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_evals"))
    # Seed the site catalog — the service uses real site records as
    # enum-bound valid values for site_id.
    forward_site
  end

  def stub_anthropic(tool_input:, tool_name: Ai::FilterService::TOOL_NAME)
    tool_block = double("tool_block", type: :tool_use, name: tool_name, input: tool_input)
    response   = double("anthropic_response", content: [tool_block])
    messages   = double("messages", create: response)
    client     = double("anthropic_client", messages: messages)
    allow(Anthropic::Client).to receive(:new).and_return(client)
  end

  it "golden 1: 'show high priority tasks at Forward Site Alpha' extracts site + priority" do
    stub_anthropic(tool_input: {
      site_id: forward_site.id,
      workflow_status: "triaged",
      priority: "high",
    })

    result = Ai::FilterService.call(
      query: "show high priority tasks at Forward Site Alpha",
      user: commander,
    )

    expect(result.success).to be(true)
    expect(result.payload[:filters]).to include(
      site_id: forward_site.id,
      priority: "high",
      workflow_status: "triaged",
    )
  end

  it "golden 2: model hallucinates a non-existent site_id — normalised to nil" do
    # Ai::FilterService's tool schema embeds real site UUIDs as an
    # enum, so a hallucinated UUID should not match. The service
    # layer also validates against valid_site_ids, returning nil
    # for anything outside the catalog.
    fake_uuid = SecureRandom.uuid
    stub_anthropic(tool_input: {
      site_id: fake_uuid,
      priority: "high",
    })

    result = Ai::FilterService.call(query: "show high pri tasks", user: commander)

    expect(result.success).to be(true)
    expect(result.payload[:filters][:site_id]).to be_nil
    expect(result.payload[:filters][:priority]).to eq("high")
  end

  it "golden 3: model returns enum-invalid workflow_status — normalised to nil" do
    # If the model somehow outputs "super_critical" as workflow_status
    # (outside the allowed enum), the validator normalises it to nil
    # rather than passing the garbage through to the downstream query.
    stub_anthropic(tool_input: {
      workflow_status: "super_critical",
      priority: "high",
    })

    result = Ai::FilterService.call(query: "critical tasks", user: commander)

    expect(result.success).to be(true)
    expect(result.payload[:filters][:workflow_status]).to be_nil
    expect(result.payload[:filters][:priority]).to eq("high")
  end

  it "golden 4: model returns no tool_use block (rare, but has happened with model drift)" do
    # If the model returns only text content and skips the required
    # tool call, the service fails loudly rather than passing garbage
    # through. Pins the behaviour the anthropic 1.23 SDK shape-fix
    # added (commit 3430a65).
    text_block = double("text_block", type: :text, name: nil, input: nil)
    response   = double("anthropic_response", content: [text_block])
    messages   = double("messages", create: response)
    client     = double("anthropic_client", messages: messages)
    allow(Anthropic::Client).to receive(:new).and_return(client)

    result = Ai::FilterService.call(query: "anything", user: commander)

    expect(result.success).to be(false)
    expect(result.errors.join).to match(/AI did not return a filter tool call/)
  end
end
