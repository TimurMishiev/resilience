require "rails_helper"

RSpec.describe Recommendations::RuleEngine, type: :service do
  subject(:result) { described_class.call(context: context) }

  let(:site)  { create(:site) }
  let(:match) { create(:signal_rule_match, site: site, workflow_status: "unacknowledged", confidence: 0.3, fired_at: 6.hours.ago) }

  def base_context
    {
      stale_alerts:        [],
      high_conf_alerts:    [],
      open_incidents:      [],
      overdue_tasks:       [],
      flaggable_sites:     [],
      bulk_triage_sites:   [],
      risk_snapshots:      [],
      posture_by_site_id:             {},
      asset_availability:             { available: 2, assigned: 1, degraded: 0, offline: 0 },
      available_assets:               [],
      unassigned_high_priority_tasks: [],
    }
  end

  describe "close_stale_alert" do
    let(:context) do
      base_context.merge(
        stale_alerts: [{
          id:              match.id,
          site_id:         site.id,
          site_name:       site.name,
          rule_name:       "OSINT Rule",
          signal_type:     "seismic_event",
          confidence:      0.30,
          fired_at:        6.hours.ago.iso8601,
          workflow_status: "unacknowledged",
          geofence_breach: false,
        }],
      )
    end

    it "produces a close_stale_alert recommendation" do
      expect(result).to be_success
      expect(result.recommendations.size).to eq 1
      rec = result.recommendations.first
      expect(rec[:recommendation_type]).to eq "close_stale_alert"
      expect(rec[:tier]).to eq "rule"
      expect(rec[:confidence]).to eq 0.85
    end

    it "skips if a pending duplicate already exists" do
      create(:recommendation, recommendation_type: "close_stale_alert",
             affected_entity_type: "SignalRuleMatch", affected_entity_id: match.id, expires_at: 2.hours.from_now)
      expect(result.recommendations).to be_empty
    end

    it "does not fire for high-confidence stale alerts" do
      high_conf_context = base_context.merge(
        stale_alerts: [{
          id:              match.id,
          site_id:         site.id,
          site_name:       site.name,
          rule_name:       "OSINT Rule",
          signal_type:     "seismic_event",
          confidence:      0.75,
          fired_at:        6.hours.ago.iso8601,
          workflow_status: "unacknowledged",
          geofence_breach: false,
        }],
      )
      expect(described_class.call(context: high_conf_context).recommendations).to be_empty
    end
  end

  describe "acknowledge_high_conf_alerts" do
    let(:high_match) { create(:signal_rule_match, site: site, workflow_status: "unacknowledged", confidence: 0.9) }

    let(:context) do
      base_context.merge(
        high_conf_alerts: [{
          id:              high_match.id,
          site_id:         site.id,
          site_name:       site.name,
          rule_name:       "Critical Rule",
          signal_type:     "aircraft",
          confidence:      0.90,
          fired_at:        1.hour.ago.iso8601,
          workflow_status: "unacknowledged",
          geofence_breach: false,
        }],
      )
    end

    it "produces an acknowledge_alert recommendation" do
      expect(result).to be_success
      rec = result.recommendations.first
      expect(rec[:recommendation_type]).to eq "acknowledge_alert"
      expect(rec[:confidence]).to be_within(0.01).of(0.90)
    end
  end

  describe "escalate_incident" do
    let(:incident) { create(:incident, :critical, status: "open", site: site, confidence: 0.85) }

    let(:context) do
      base_context.merge(
        open_incidents: [{
          id:          incident.id,
          title:       incident.title,
          status:      "open",
          severity:    "critical",
          confidence:  0.85,
          alert_count: 3,
          site_id:     site.id,
          site_name:   site.name,
          opened_at:   incident.opened_at.iso8601,
        }],
      )
    end

    it "produces an escalate_incident recommendation" do
      expect(result).to be_success
      rec = result.recommendations.first
      expect(rec[:recommendation_type]).to eq "escalate_incident"
      expect(rec[:affected_entity_type]).to eq "Incident"
    end

    it "does not fire for low/moderate severity incidents" do
      ctx = base_context.merge(
        open_incidents: [{
          id:          incident.id,
          title:       incident.title,
          status:      "open",
          severity:    "moderate",
          confidence:  0.55,
          alert_count: 1,
          site_id:     site.id,
          site_name:   site.name,
          opened_at:   incident.opened_at.iso8601,
        }],
      )
      expect(described_class.call(context: ctx)).to be_success
      expect(described_class.call(context: ctx).recommendations).to be_empty
    end
  end

  describe "escalate_incident — posture awareness" do
    let(:incident) { create(:incident, :critical, status: "open", site: site, confidence: 0.80) }

    def incident_context(posture_map)
      base_context.merge(
        open_incidents: [{
          id:          incident.id,
          title:       incident.title,
          status:      "open",
          severity:    "critical",
          confidence:  0.80,
          alert_count: 2,
          site_id:     site.id,
          site_name:   site.name,
          opened_at:   incident.opened_at.iso8601,
        }],
        posture_by_site_id: posture_map,
      )
    end

    it "reduces confidence by 30% when AO posture is observe" do
      ctx = incident_context(site.id => { ao_id: "ao-1", ao_name: "EUCOM", posture: "observe" })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be_within(0.001).of(0.80 * 0.7)
    end

    it "includes observe posture note in rationale" do
      ctx = incident_context(site.id => { ao_id: "ao-1", ao_name: "EUCOM", posture: "observe" })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:rationale]).to include("Observe")
      expect(rec[:rationale]).to include("not yet authorised")
    end

    it "does not reduce confidence for defensive posture" do
      ctx = incident_context(site.id => { ao_id: "ao-1", ao_name: "EUCOM", posture: "defensive" })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be_within(0.001).of(0.80)
      expect(rec[:rationale]).to include("Defensive")
    end

    it "notes Weapons Free posture in rationale" do
      ctx = incident_context(site.id => { ao_id: "ao-1", ao_name: "EUCOM", posture: "weapons_free" })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be_within(0.001).of(0.80)
      expect(rec[:rationale]).to include("Weapons Free")
    end

    it "produces recommendation without posture note when site has no AO" do
      ctx = incident_context({})
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be_within(0.001).of(0.80)
      expect(rec[:rationale]).not_to include("posture")
    end
  end

  describe "flag_high_risk_sites — asset coverage" do
    let(:context) do
      base_context.merge(flaggable_sites: [{ id: site.id, name: site.name, risk_score: 0.80 }])
    end

    it "boosts confidence when no actionable assets exist" do
      ctx = context.merge(asset_availability: { available: 0, assigned: 0, degraded: 1, offline: 2 })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be > 0.80
      expect(rec[:rationale]).to include("no coverage")
    end

    it "notes available asset count in rationale when assets exist" do
      ctx = context.merge(asset_availability: { available: 3, assigned: 1, degraded: 0, offline: 0 })
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:rationale]).to include("3 asset(s) currently available")
    end

    it "does not exceed 0.95 confidence cap even when boosted" do
      ctx = context.merge(
        flaggable_sites:   [{ id: site.id, name: site.name, risk_score: 0.94 }],
        asset_availability: { available: 0, assigned: 0, degraded: 0, offline: 0 },
      )
      rec = described_class.call(context: ctx).recommendations.first
      expect(rec[:confidence]).to be <= 0.95
    end
  end

  describe "bulk_triage_alerts" do
    let(:context) do
      base_context.merge(
        bulk_triage_sites: [{ site_id: site.id, unacked_count: 7 }],
      )
    end

    it "produces a bulk_triage_alerts recommendation" do
      expect(result).to be_success
      rec = result.recommendations.first
      expect(rec[:recommendation_type]).to eq "bulk_triage_alerts"
      expect(rec[:action_payload][:unacked_count]).to eq 7
    end
  end

  describe "flag_high_risk_sites" do
    let(:context) do
      base_context.merge(
        flaggable_sites: [{ id: site.id, name: site.name, risk_score: 0.88 }],
      )
    end

    it "produces a flag_site recommendation" do
      expect(result).to be_success
      rec = result.recommendations.first
      expect(rec[:recommendation_type]).to eq "flag_site"
      expect(rec[:confidence]).to be_within(0.01).of(0.88)
    end
  end

  describe "suggest_asset_assignments" do
    let(:task)  { create(:task, priority: "critical", workflow_status: "new", asset_id: nil, site: site) }
    let(:asset) { create(:asset, status: "available") }

    let(:task_stub)  { { id: task.id,  title: task.title,  priority: "critical", workflow_status: "new", site_id: site.id, site_name: site.name, updated_at: task.updated_at.iso8601 } }
    let(:asset_stub) { { id: asset.id, name: asset.name, asset_type: asset.asset_type } }

    context "when there are unassigned high-priority tasks and available assets" do
      let(:context) do
        base_context.merge(
          available_assets:               [asset_stub],
          unassigned_high_priority_tasks: [task_stub],
        )
      end

      it "produces an assign_asset recommendation" do
        expect(result).to be_success
        rec = result.recommendations.first
        expect(rec[:recommendation_type]).to eq "assign_asset"
        expect(rec[:action_payload][:task_id]).to eq task.id
        expect(rec[:action_payload][:asset_id]).to eq asset.id
        expect(rec[:confidence]).to eq 0.88
      end
    end

    context "when no assets are available" do
      let(:context) do
        base_context.merge(
          available_assets:               [],
          unassigned_high_priority_tasks: [task_stub],
        )
      end

      it "produces no recommendations" do
        expect(result).to be_success
        expect(result.recommendations).to be_empty
      end
    end

    context "when the task's AO is in Observe posture" do
      let(:context) do
        base_context.merge(
          available_assets:               [asset_stub],
          unassigned_high_priority_tasks: [task_stub],
          posture_by_site_id:             { site.id => { ao_id: "ao-1", ao_name: "AO Alpha", posture: "observe" } },
        )
      end

      it "skips the task" do
        expect(result).to be_success
        expect(result.recommendations).to be_empty
      end
    end
  end

  it "returns success even when context is empty" do
    expect(described_class.call(context: base_context)).to be_success
    expect(described_class.call(context: base_context).recommendations).to be_empty
  end
end
