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

    it "rejects evidence items with non-existent asset IDs" do
      attrs = valid_attrs(evidence: [{ "type" => "asset", "id" => SecureRandom.uuid }])
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

  describe "cross-entity consistency (payload-to-target match)" do
    # Regression: previously the type/entity coherence was checked only
    # *inside* each case branch via `if entity_type == "Incident" ...`,
    # which meant a mismatched entity_type silently bypassed the check 4
    # guarantee (ADR-005). An LLM producing `type: escalate_incident` with
    # `affected_entity_type: Site` would pass validation and execute an
    # escalation against an unrelated incident id in the payload.
    it "rejects escalate_incident when affected_entity_type is not Incident" do
      incident = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "escalate_incident",
        affected_entity_type: "Site",
        affected_entity_id:   site.id,
        action_payload:       { "incident_id" => incident.id, "to_status" => "acknowledged" },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join).to match(
        /recommendation_type 'escalate_incident' requires affected_entity_type 'Incident', got 'Site'/
      )
    end

    it "rejects flag_site when affected_entity_type is not Site" do
      incident = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Incident",
        affected_entity_id:   incident.id,
        action_payload:       { "site_id" => site.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join).to match(
        /recommendation_type 'flag_site' requires affected_entity_type 'Site'/
      )
    end

    it "rejects assign_asset when affected_entity_type is not Task" do
      task = create(:task, site: site)
      asset = create(:asset, home_site: site)
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Site",
        affected_entity_id:   site.id,
        action_payload:       { "task_id" => task.id, "asset_id" => asset.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join).to match(
        /recommendation_type 'assign_asset' requires affected_entity_type 'Task'/
      )
    end

    it "rejects escalate_incident when payload incident_id differs from affected_entity_id" do
      incident_a = create(:incident, site: site)
      incident_b = create(:incident, site: site)
      attrs = valid_attrs(
        recommendation_type:  "escalate_incident",
        affected_entity_type: "Incident",
        affected_entity_id:   incident_a.id,
        action_payload:       { "incident_id" => incident_b.id, "to_status" => "acknowledged" },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors]).to include(
        "action_payload incident_id does not match affected_entity_id"
      )
    end

    it "accepts escalate_incident when payload incident_id matches affected_entity_id" do
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

    it "rejects acknowledge_alert when payload alert_id belongs to a different incident" do
      incident_a  = create(:incident, site: site)
      incident_b  = create(:incident, site: site)
      alert_for_b = create(:signal_rule_match, site: site, incident: incident_b)
      attrs = valid_attrs(
        recommendation_type:  "acknowledge_alert",
        affected_entity_type: "Incident",
        affected_entity_id:   incident_a.id,
        action_payload:       { "alert_id" => alert_for_b.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors]).to include(
        "action_payload alert_id does not belong to the surfaced incident"
      )
    end

    it "rejects flag_site when payload site_id differs from affected_entity_id" do
      site_b = create(:site)
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site.id,
        action_payload:       { "site_id" => site_b.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors]).to include(
        "action_payload site_id does not match affected_entity_id"
      )
    end

    it "accepts flag_site when payload site_id matches affected_entity_id" do
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site.id,
        action_payload:       { "site_id" => site.id },
        evidence:             []
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid.size).to eq 1
    end
  end

  describe "assign_asset payload validation" do
    let(:task)  { create(:task,  site: site) }
    let(:asset) { create(:asset, status: "available") }

    it "accepts a valid assign_asset recommendation" do
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Task",
        affected_entity_id:   task.id,
        action_payload:       { "task_id" => task.id, "asset_id" => asset.id },
        evidence:             [
          { "type" => "task", "id" => task.id, "detail" => "priority=high" },
          { "type" => "asset", "id" => asset.id, "detail" => "status=available" },
        ],
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid.size).to eq 1
      expect(result.invalid).to be_empty
    end

    it "rejects when task_id is missing from payload" do
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Task",
        affected_entity_id:   task.id,
        action_payload:       { "asset_id" => asset.id },
        evidence:             [],
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors]).to include("action_payload missing required key 'task_id'")
    end

    it "rejects when asset_id does not exist" do
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Task",
        affected_entity_id:   task.id,
        action_payload:       { "task_id" => task.id, "asset_id" => SecureRandom.uuid },
        evidence:             [],
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].first).to match(/asset_id .* does not exist/)
    end

    it "rejects when payload task_id does not match affected_entity_id" do
      other_task = create(:task, site: site)
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Task",
        affected_entity_id:   task.id,
        action_payload:       { "task_id" => other_task.id, "asset_id" => asset.id },
        evidence:             [],
      )
      result = described_class.call(recommendations: [attrs])
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors]).to include(
        "action_payload task_id does not match affected_entity_id"
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

  # Defense-in-depth regression for the "Validator does not enforce tenant
  # scope on entity-existence checks" finding (audit 2026-05-01 P3):
  #
  #   ContextAssembler is per-tenant when organization_id is set, so the
  #   LLM only ever sees in-tenant ids. But a hallucinated bigserial id
  #   could collide with another tenant's row. Pre-fix, Validator's
  #   `klass.exists?(id)` was a global query — a cross-tenant collision
  #   would pass and the recommendation would persist (invisible to all
  #   normal operators via RecommendationPolicy::Scope, but visible to
  #   unrestricted admins and wasteful as an LLM-tier slot).
  #
  #   Fix: Validator accepts organization_id and tenant-scopes every
  #   existence check via the same per-class rules ContextAssembler uses
  #   (Site direct, SRM/Task via site, Incident via site OR ao, Asset via
  #   home_site). ExecutorService#find_scoped + RecommendationPolicy
  #   remain the primary tenant-action / tenant-visibility boundary;
  #   this is the upstream defense-in-depth layer that prevents the
  #   wasteful persistence in the first place.
  describe "tenant-scoped entity validation (defense-in-depth)" do
    let(:org_a) { create(:organization, name: "Org A") }
    let(:org_b) { create(:organization, name: "Org B") }
    let(:site_a) { create(:site, organization: org_a) }
    let(:site_b) { create(:site, organization: org_b) }

    it "rejects a recommendation pointing at another tenant's Site when org_a-scoped" do
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site_b.id,
        action_payload:       { "site_id" => site_b.id },
        evidence:             [{ "type" => "site", "id" => site_b.id, "detail" => "score=0.85" }],
      )

      result = described_class.call(recommendations: [attrs], organization_id: org_a.id)
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join(", "))
        .to include("Site #{site_b.id} does not exist")
    end

    it "accepts a recommendation pointing at the same-tenant Site when org_a-scoped" do
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site_a.id,
        action_payload:       { "site_id" => site_a.id },
        evidence:             [{ "type" => "site", "id" => site_a.id, "detail" => "score=0.85" }],
      )

      result = described_class.call(recommendations: [attrs], organization_id: org_a.id)
      expect(result.valid.size).to eq 1
      expect(result.invalid).to be_empty
    end

    it "rejects evidence items pointing at another tenant's Site when org_a-scoped" do
      attrs = valid_attrs(
        affected_entity_type: "SignalRuleMatch",
        affected_entity_id:   create(:signal_rule_match, site: site_a).id,
        action_payload:       { "alert_id" => create(:signal_rule_match, site: site_a).id, "to_status" => "acknowledged" },
        evidence:             [{ "type" => "site", "id" => site_b.id }],
      )

      result = described_class.call(recommendations: [attrs], organization_id: org_a.id)
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join(", "))
        .to include("does not exist")
    end

    it "rejects action_payload referencing another tenant's Task when org_a-scoped" do
      task_b  = create(:task, site: site_b)
      asset_a = create(:asset, home_site: site_a)
      attrs = valid_attrs(
        recommendation_type:  "assign_asset",
        affected_entity_type: "Task",
        affected_entity_id:   task_b.id,
        action_payload:       { "task_id" => task_b.id, "asset_id" => asset_a.id },
        evidence:             [{ "type" => "task", "id" => task_b.id }],
      )

      result = described_class.call(recommendations: [attrs], organization_id: org_a.id)
      expect(result.valid).to be_empty
      expect(result.invalid.first[:errors].join(", "))
        .to include("does not exist")
    end

    it "preserves global behavior when organization_id is nil (single-tenant default)" do
      attrs = valid_attrs(
        recommendation_type:  "flag_site",
        affected_entity_type: "Site",
        affected_entity_id:   site_b.id,
        action_payload:       { "site_id" => site_b.id },
        evidence:             [{ "type" => "site", "id" => site_b.id, "detail" => "score=0.85" }],
      )

      result = described_class.call(recommendations: [attrs])
      expect(result.valid.size).to eq 1
    end
  end
end
