require "rails_helper"

RSpec.describe Recommendations::Validator, type: :service do
  let(:site)  { create(:site) }
  let(:srm)   { create(:signal_rule_match, site: site) }  # avoids conflict with RSpec `match` matcher

  def valid_attrs(overrides = {})
    {
      recommendation_type:  "acknowledge_alert",
      tier:                 "rule",
      confidence:           0.85,
      rationale:            "High-confidence alert needs triage.",
      evidence:             [{ "type" => "alert", "id" => srm.id, "detail" => "conf=0.85" }],
      action_payload:       { "alert_id" => srm.id, "to_status" => "acknowledged" },
      affected_entity_type: "SignalRuleMatch",
      affected_entity_id:   srm.id,
      expires_at:           2.hours.from_now,
      status:               "pending",
    }.merge(overrides)
  end

  describe "primary entity validation" do
    it "accepts a valid recommendation with an existing entity" do
      result = described_class.call(recommendations: [valid_attrs])
      expect(result.valid.size).to eq 1
      expect(result.invalid).to be_empty
    end

    it "rejects if the primary entity ID does not exist" do
      attrs = valid_attrs(affected_entity_id: SecureRandom.uuid)
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].first).to include("does not exist")
    end

    it "rejects an unknown entity type" do
      attrs = valid_attrs(affected_entity_type: "WeaponSystem")
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors].first).to include("unknown entity type")
    end
  end

  describe "evidence provenance validation" do
    it "accepts evidence items whose IDs exist in the database" do
      result = described_class.call(recommendations: [valid_attrs])
      expect(result.valid.size).to eq 1
    end

    it "rejects evidence items with non-existent IDs (LLM hallucination guard)" do
      hallucinated_id = SecureRandom.uuid
      attrs = valid_attrs(evidence: [{ "type" => "alert", "id" => hallucinated_id }])
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].first).to include("does not exist")
    end

    it "rejects evidence items with non-existent site IDs" do
      attrs = valid_attrs(evidence: [{ "type" => "site", "id" => SecureRandom.uuid }])
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors].first).to include("does not exist")
    end

    it "accepts evidence items with unknown type strings (not in ENTITY_CLASSES)" do
      # Unknown types are skipped (not rejected) so forward compatibility is preserved
      attrs = valid_attrs(evidence: [{ "type" => "unknown_future_type", "id" => SecureRandom.uuid }])
      result = described_class.call(recommendations: [attrs])
      expect(result.valid.size).to eq 1
    end

    it "rejects evidence items missing id" do
      attrs = valid_attrs(evidence: [{ "type" => "alert" }])
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors].first).to include("must have type and id")
    end

    it "accepts both string-keyed and symbol-keyed evidence items" do
      sym_evidence = [{ type: "alert", id: srm.id }]
      result = described_class.call(recommendations: [valid_attrs(evidence: sym_evidence)])
      expect(result.valid.size).to eq 1
    end
  end

  describe "action_payload validation" do
    it "accepts a payload whose IDs all exist" do
      result = described_class.call(recommendations: [valid_attrs])
      expect(result.valid.size).to eq 1
      expect(result.invalid).to be_empty
    end

    it "rejects acknowledge_alert when alert_id is missing" do
      attrs = valid_attrs(action_payload: {})
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors]).to include(
        "action_payload missing required key 'alert_id'"
      )
    end

    it "rejects acknowledge_alert when alert_id does not exist in DB" do
      attrs = valid_attrs(action_payload: { "alert_id" => SecureRandom.uuid })
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors]).to include(
        a_string_matching("action_payload alert_id .* does not exist")
      )
    end

    it "rejects escalate_incident when incident_id does not exist" do
      incident = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "escalate_incident",
        affected_entity_type: "Incident",
        affected_entity_id:   incident.id,
        action_payload:       { "incident_id" => SecureRandom.uuid, "to_status" => "acknowledged" },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors]).to include(
        a_string_matching("action_payload incident_id .* does not exist")
      )
    end

    it "rejects escalate_incident when to_status is not a valid incident status" do
      incident = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "escalate_incident",
        affected_entity_type: "Incident",
        affected_entity_id:   incident.id,
        action_payload:       { "incident_id" => incident.id, "to_status" => "hacked_status" },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors]).to include(
        a_string_matching("to_status.*is not a valid incident status")
      )
    end

    it "allows escalate_incident with no to_status (defaults to service default)" do
      incident = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "escalate_incident",
        affected_entity_type: "Incident",
        affected_entity_id:   incident.id,
        action_payload:       { "incident_id" => incident.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid.size).to eq 1
    end

    it "rejects flag_site when site_id does not exist" do
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site.id,
        action_payload:       { "site_id" => SecureRandom.uuid },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.invalid.first[:errors]).to include(
        a_string_matching("action_payload site_id .* does not exist")
      )
    end
  end

  describe "deduplication uniqueness (DB constraint)" do
    it "raises RecordNotUnique on concurrent duplicate creation" do
      create(:recommendation,
             recommendation_type:  "acknowledge_alert",
             affected_entity_type: "SignalRuleMatch",
             affected_entity_id:   srm.id,
             status:               "pending",
             expires_at:           2.hours.from_now)

      expect {
        Recommendation.create!(
          recommendation_type:  "acknowledge_alert",
          tier:                 "rule",
          confidence:           0.9,
          rationale:            "duplicate",
          affected_entity_type: "SignalRuleMatch",
          affected_entity_id:   srm.id,
          expires_at:           2.hours.from_now,
        )
      }.to raise_error(ActiveRecord::RecordNotUnique)
    end
  end
end
