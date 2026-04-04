require "rails_helper"

# Multi-tenant isolation — proves that every Pundit policy scope correctly
# restricts records to the user's organization. This is the highest-risk
# authorization test in the system: a scoping failure here means one org
# can see or act on another org's operational data.
RSpec.describe "Organization tenant isolation", type: :model do
  let(:org_a)       { create(:organization) }
  let(:org_b)       { create(:organization) }
  let(:commander_a) { create(:user, :commander, organization: org_a) }
  let(:commander_b) { create(:user, :commander, organization: org_b) }

  let(:ao_a) { create(:area_of_operation, organization: org_a, created_by: commander_a) }
  let(:ao_b) { create(:area_of_operation, organization: org_b, created_by: commander_b) }

  let(:site_a) { create(:site, organization: org_a, area_of_operation: ao_a) }
  let(:site_b) { create(:site, organization: org_b, area_of_operation: ao_b) }

  before do
    # Force creation of all shared fixtures
    site_a
    site_b
  end

  # ── Site ──────────────────────────────────────────────────────────────────────

  describe "SitePolicy::Scope" do
    it "returns only the user's org sites" do
      resolved = SitePolicy::Scope.new(commander_a, Site.all).resolve
      expect(resolved).to include(site_a)
      expect(resolved).not_to include(site_b)
    end
  end

  # ── Task ──────────────────────────────────────────────────────────────────────

  describe "TaskPolicy::Scope" do
    let!(:task_a) { create(:task, site: site_a) }
    let!(:task_b) { create(:task, site: site_b) }

    it "returns only tasks at the user's org sites" do
      resolved = TaskPolicy::Scope.new(commander_a, Task.all).resolve
      expect(resolved).to include(task_a)
      expect(resolved).not_to include(task_b)
    end
  end

  # ── Incident ──────────────────────────────────────────────────────────────────

  describe "IncidentPolicy::Scope" do
    let!(:incident_a) { create(:incident, site: site_a, area_of_operation: ao_a) }
    let!(:incident_b) { create(:incident, site: site_b, area_of_operation: ao_b) }

    it "returns only incidents at the user's org sites/AOs" do
      resolved = IncidentPolicy::Scope.new(commander_a, Incident.all).resolve
      expect(resolved).to include(incident_a)
      expect(resolved).not_to include(incident_b)
    end
  end

  # ── SignalRuleMatch ───────────────────────────────────────────────────────────

  describe "SignalRuleMatchPolicy::Scope" do
    let!(:match_a) { create(:signal_rule_match, site: site_a) }
    let!(:match_b) { create(:signal_rule_match, site: site_b) }

    it "returns only matches at the user's org sites" do
      resolved = SignalRuleMatchPolicy::Scope.new(commander_a, SignalRuleMatch.all).resolve
      expect(resolved).to include(match_a)
      expect(resolved).not_to include(match_b)
    end
  end

  # ── CorrelationRule ───────────────────────────────────────────────────────────

  describe "CorrelationRulePolicy::Scope" do
    let!(:rule_a) { create(:correlation_rule, area_of_operation: ao_a) }
    let!(:rule_b) { create(:correlation_rule, area_of_operation: ao_b) }

    it "returns only rules in the user's org AOs" do
      resolved = CorrelationRulePolicy::Scope.new(commander_a, CorrelationRule.all).resolve
      expect(resolved).to include(rule_a)
      expect(resolved).not_to include(rule_b)
    end
  end

  # ── Asset ─────────────────────────────────────────────────────────────────────

  describe "AssetPolicy::Scope" do
    let!(:asset_a) { create(:asset, home_site: site_a) }
    let!(:asset_b) { create(:asset, home_site: site_b) }

    it "returns only assets homed at the user's org sites" do
      resolved = AssetPolicy::Scope.new(commander_a, Asset.all).resolve
      expect(resolved).to include(asset_a)
      expect(resolved).not_to include(asset_b)
    end
  end

  # ── AreaOfOperation ───────────────────────────────────────────────────────────

  describe "AreaOfOperationPolicy::Scope" do
    it "returns only the user's org AOs (plus org-null globals)" do
      resolved = AreaOfOperationPolicy::Scope.new(commander_a, AreaOfOperation.all).resolve
      expect(resolved).to include(ao_a)
      expect(resolved).not_to include(ao_b)
    end
  end

  # ── Chokepoint ────────────────────────────────────────────────────────────────

  describe "ChokepointPolicy::Scope" do
    let!(:cp_a) { create(:chokepoint, area_of_operation: ao_a) }
    let!(:cp_b) { create(:chokepoint, area_of_operation: ao_b) }

    it "returns only chokepoints in the user's org AOs" do
      resolved = ChokepointPolicy::Scope.new(commander_a, Chokepoint.all).resolve
      expect(resolved).to include(cp_a)
      expect(resolved).not_to include(cp_b)
    end
  end

  # ── CommanderIntent ───────────────────────────────────────────────────────────

  describe "CommanderIntentPolicy::Scope" do
    let!(:intent_a) { create(:commander_intent, area_of_operation: ao_a) }
    let!(:intent_b) { create(:commander_intent, area_of_operation: ao_b) }

    it "returns only intents in the user's org AOs" do
      resolved = CommanderIntentPolicy::Scope.new(commander_a, CommanderIntent.all).resolve
      expect(resolved).to include(intent_a)
      expect(resolved).not_to include(intent_b)
    end
  end

  # ── PacePlan ──────────────────────────────────────────────────────────────────

  describe "PacePlanPolicy::Scope" do
    let!(:pace_a) { create(:pace_plan, area_of_operation: ao_a) }
    let!(:pace_b) { create(:pace_plan, area_of_operation: ao_b) }

    it "returns only pace plans in the user's org AOs" do
      resolved = PacePlanPolicy::Scope.new(commander_a, PacePlan.all).resolve
      expect(resolved).to include(pace_a)
      expect(resolved).not_to include(pace_b)
    end
  end

  # ── SaluteReport ──────────────────────────────────────────────────────────────

  describe "SaluteReportPolicy::Scope" do
    let!(:salute_a) { create(:salute_report, area_of_operation: ao_a) }
    let!(:salute_b) { create(:salute_report, area_of_operation: ao_b) }

    it "returns only salute reports in the user's org AOs" do
      resolved = SaluteReportPolicy::Scope.new(commander_a, SaluteReport.all).resolve
      expect(resolved).to include(salute_a)
      expect(resolved).not_to include(salute_b)
    end
  end

  # ── Recommendation ────────────────────────────────────────────────────────────

  describe "RecommendationPolicy::Scope" do
    let!(:rec_a) do
      create(:recommendation, :for_site,
             affected_entity_id: site_a.id,
             action_payload: { "site_id" => site_a.id },
             expires_at: 2.hours.from_now)
    end
    let!(:rec_b) do
      create(:recommendation, :for_site,
             affected_entity_id: site_b.id,
             action_payload: { "site_id" => site_b.id },
             expires_at: 2.hours.from_now)
    end

    it "returns only recommendations for entities in the user's org" do
      resolved = RecommendationPolicy::Scope.new(commander_a, Recommendation.all).resolve
      expect(resolved).to include(rec_a)
      expect(resolved).not_to include(rec_b)
    end
  end

  # ── Unscoped user sees everything ─────────────────────────────────────────────

  describe "unscoped user (no org)" do
    let(:unscoped_user) { create(:user, :commander, organization: nil) }

    it "sees all sites" do
      resolved = SitePolicy::Scope.new(unscoped_user, Site.all).resolve
      expect(resolved).to include(site_a, site_b)
    end

    it "sees all areas of operation" do
      resolved = AreaOfOperationPolicy::Scope.new(unscoped_user, AreaOfOperation.all).resolve
      expect(resolved).to include(ao_a, ao_b)
    end
  end
end
