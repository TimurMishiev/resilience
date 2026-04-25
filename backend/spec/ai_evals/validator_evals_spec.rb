require "rails_helper"

# AI evaluation harness for Recommendations::Validator — ADR-005's
# four-check trust boundary.
#
# Each eval pins a known-good verdict (valid / invalid) on a realistic
# recommendation attributes hash. The hash shape is what the LLM
# enricher would have produced; the validator is run directly without
# any Anthropic calls.
#
# See spec/ai_evals/README.md for how to add new evals.
RSpec.describe "AI eval: Recommendations::Validator", type: :service do
  let(:site)     { create(:site, name: "Site Alpha") }
  let(:incident) { create(:incident, site: site, status: "open") }
  let(:alert)    { create(:signal_rule_match, site: site, incident: incident) }
  let(:task)     { create(:task, site: site) }
  let(:asset)    { create(:asset, home_site: site) }

  def call(attrs)
    Recommendations::Validator.call(recommendations: [attrs])
  end

  it "golden 1: close_stale_alert surfaced against its own alert — valid" do
    attrs = {
      recommendation_type:  "close_stale_alert",
      tier:                 "llm",
      confidence:           0.9,
      rationale:            "Alert has been unacknowledged for 48h with no escalation.",
      evidence:             [{ "type" => "alert", "id" => alert.id }],
      action_payload:       { "alert_id" => alert.id, "to_status" => "closed" },
      affected_entity_type: "SignalRuleMatch",
      affected_entity_id:   alert.id,
      expires_at:           2.hours.from_now,
      status:               "pending",
    }
    result = call(attrs)
    expect(result.valid.size).to eq(1)
    expect(result.invalid).to be_empty
  end

  it "golden 2: LLM-hallucinated affected_entity_id — rejected (check 1)" do
    attrs = {
      recommendation_type:  "close_stale_alert",
      tier:                 "llm",
      confidence:           0.9,
      rationale:            "…",
      evidence:             [{ "type" => "alert", "id" => alert.id }],
      action_payload:       { "alert_id" => alert.id, "to_status" => "closed" },
      affected_entity_type: "SignalRuleMatch",
      affected_entity_id:   SecureRandom.uuid, # hallucinated
      expires_at:           2.hours.from_now,
      status:               "pending",
    }
    result = call(attrs)
    expect(result.valid).to be_empty
    expect(result.invalid.first[:errors].join).to match(/SignalRuleMatch .* does not exist/)
  end

  it "golden 3: type/entity mismatch — escalate_incident on a Site — rejected (check 4, post-fix)" do
    # Regression for the validator bypass closed in commit 10091e1:
    # case type == "escalate_incident" with entity_type == "Site"
    # used to silently skip check 4. Now the EXPECTED_ENTITY_TYPES
    # allow-list rejects the mismatch up front.
    attrs = {
      recommendation_type:  "escalate_incident",
      tier:                 "llm",
      confidence:           0.9,
      rationale:            "…",
      evidence:             [{ "type" => "incident", "id" => incident.id }],
      action_payload:       { "incident_id" => incident.id, "to_status" => "acknowledged" },
      affected_entity_type: "Site",            # mismatch
      affected_entity_id:   site.id,
      expires_at:           2.hours.from_now,
      status:               "pending",
    }
    result = call(attrs)
    expect(result.valid).to be_empty
    expect(result.invalid.first[:errors].join).to match(
      /recommendation_type 'escalate_incident' requires affected_entity_type 'Incident'/
    )
  end

  it "golden 4: payload target mismatch — shown against Incident A, payload carries Alert-of-Incident-B" do
    other_incident = create(:incident, site: site, status: "open")
    alert_for_other = create(:signal_rule_match, site: site, incident: other_incident)

    attrs = {
      recommendation_type:  "close_stale_alert",
      tier:                 "llm",
      confidence:           0.9,
      rationale:            "…",
      evidence:             [{ "type" => "incident", "id" => incident.id }],
      action_payload:       { "alert_id" => alert_for_other.id, "to_status" => "closed" },
      affected_entity_type: "Incident",
      affected_entity_id:   incident.id,  # this incident
      expires_at:           2.hours.from_now,
      status:               "pending",
    }
    result = call(attrs)
    expect(result.valid).to be_empty
    expect(result.invalid.first[:errors].join).to match(/alert_id does not belong to the surfaced incident/)
  end

  it "golden 5: assign_asset with a valid task + asset in the same site — valid" do
    attrs = {
      recommendation_type:  "assign_asset",
      tier:                 "llm",
      confidence:           0.8,
      rationale:            "Asset is available and closest to the task site.",
      evidence:             [{ "type" => "task", "id" => task.id }, { "type" => "asset", "id" => asset.id }],
      action_payload:       { "task_id" => task.id, "asset_id" => asset.id },
      affected_entity_type: "Task",
      affected_entity_id:   task.id,
      expires_at:           2.hours.from_now,
      status:               "pending",
    }
    result = call(attrs)
    expect(result.valid.size).to eq(1)
  end
end
