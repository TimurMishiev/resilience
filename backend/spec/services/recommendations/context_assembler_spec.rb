require "rails_helper"

RSpec.describe Recommendations::ContextAssembler, type: :service do
  subject(:result) { described_class.call }

  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
  end

  it "returns a successful ServiceResult" do
    expect(result).to be_success
  end

  it "returns a context hash with all required keys" do
    ctx = result.payload[:context]
    expect(ctx.keys).to include(
      :assembled_at,
      :stale_alerts,
      :high_conf_alerts,
      :open_incidents,
      :overdue_tasks,
      :flaggable_sites,
      :bulk_triage_sites,
      :risk_snapshots,
      :posture_by_site_id,
      :asset_availability,
      :available_assets,
      :unassigned_high_priority_tasks,
    )
  end

  describe "stale_alerts" do
    it "includes unacknowledged alerts older than STALE_ALERT_HOURS" do
      site  = create(:site)
      match = create(:signal_rule_match,
                     site:            site,
                     workflow_status: "unacknowledged",
                     confidence:      0.5,
                     fired_at:        (described_class::STALE_ALERT_HOURS + 1).hours.ago)

      ctx = result.payload[:context]
      expect(ctx[:stale_alerts].map { |a| a[:id] }).to include(match.id)
    end

    it "excludes recent alerts" do
      site  = create(:site)
      match = create(:signal_rule_match,
                     site:            site,
                     workflow_status: "unacknowledged",
                     confidence:      0.5,
                     fired_at:        1.hour.ago)

      ctx = result.payload[:context]
      expect(ctx[:stale_alerts].map { |a| a[:id] }).not_to include(match.id)
    end
  end

  describe "high_conf_alerts" do
    it "includes unacknowledged alerts above HIGH_CONF_THRESHOLD" do
      site  = create(:site)
      match = create(:signal_rule_match,
                     site:            site,
                     workflow_status: "unacknowledged",
                     confidence:      described_class::HIGH_CONF_THRESHOLD + 0.01,
                     fired_at:        30.minutes.ago)

      ctx = result.payload[:context]
      expect(ctx[:high_conf_alerts].map { |a| a[:id] }).to include(match.id)
    end
  end

  describe "asset_availability" do
    it "counts assets by status" do
      create(:asset, status: "available")
      create(:asset, status: "available")
      create(:asset, status: "assigned")
      create(:asset, status: "offline")

      ctx = result.payload[:context]
      av  = ctx[:asset_availability]
      expect(av[:available]).to eq(2)
      expect(av[:assigned]).to eq(1)
      expect(av[:offline]).to eq(1)
      expect(av[:degraded]).to eq(0)
    end

    it "returns zeroed hash when no assets exist" do
      ctx = result.payload[:context]
      av  = ctx[:asset_availability]
      expect(av).to eq(available: 0, assigned: 0, degraded: 0, offline: 0)
    end
  end

  describe "flaggable_sites" do
    it "returns sites with high recent risk scores that are not yet flagged" do
      site = create(:site, flagged_at: nil)
      create(:site_risk_snapshot, site: site, score: 85, recorded_at: 1.hour.ago)

      ctx = result.payload[:context]
      expect(ctx[:flaggable_sites].map { |s| s[:id] }).to include(site.id)
    end

    it "excludes sites already flagged" do
      site = create(:site, flagged_at: 1.hour.ago)
      create(:site_risk_snapshot, site: site, score: 90, recorded_at: 30.minutes.ago)

      ctx = result.payload[:context]
      expect(ctx[:flaggable_sites].map { |s| s[:id] }).not_to include(site.id)
    end

    it "excludes sites with risk score below 75" do
      site = create(:site, flagged_at: nil)
      create(:site_risk_snapshot, site: site, score: 60, recorded_at: 1.hour.ago)

      ctx = result.payload[:context]
      expect(ctx[:flaggable_sites].map { |s| s[:id] }).not_to include(site.id)
    end
  end

  describe "posture_by_site_id" do
    it "returns posture keyed by site id" do
      ao   = create(:area_of_operation, posture: "observe")
      site = create(:site, area_of_operation: ao)

      ctx = result.payload[:context]
      entry = ctx[:posture_by_site_id][site.id]
      expect(entry).to include(ao_id: ao.id, posture: "observe")
    end

    it "excludes sites with no area_of_operation" do
      site = create(:site, area_of_operation: nil)

      ctx = result.payload[:context]
      expect(ctx[:posture_by_site_id].keys).not_to include(site.id)
    end
  end

  describe "bulk_triage_sites" do
    it "surfaces sites with >= BULK_TRIAGE_THRESHOLD unacknowledged alerts" do
      site = create(:site)
      described_class::BULK_TRIAGE_THRESHOLD.times do
        create(:signal_rule_match,
               site:            site,
               workflow_status: "unacknowledged",
               fired_at:        1.hour.ago)
      end

      ctx = result.payload[:context]
      site_ids = ctx[:bulk_triage_sites].map { |s| s[:site_id] }
      expect(site_ids).to include(site.id)
    end

    it "does not surface sites below the threshold" do
      site = create(:site)
      (described_class::BULK_TRIAGE_THRESHOLD - 1).times do
        create(:signal_rule_match,
               site:            site,
               workflow_status: "unacknowledged",
               fired_at:        1.hour.ago)
      end

      ctx = result.payload[:context]
      site_ids = ctx[:bulk_triage_sites].map { |s| s[:site_id] }
      expect(site_ids).not_to include(site.id)
    end
  end

  describe "tenant scoping (MT2)" do
    # Every query in ContextAssembler is covered by a tenant-scoped test below
    # to prove that when organization_id is provided, reads are restricted to
    # the tenant's entities. The nil-organization_id path is already covered
    # by every other describe block in this file (each uses described_class.call
    # with no args), which continues to exercise global-read behavior.

    let(:org_a) { create(:organization) }
    let(:org_b) { create(:organization) }
    let(:site_a) { create(:site, organization: org_a) }
    let(:site_b) { create(:site, organization: org_b) }

    def assemble_for(org)
      described_class.call(organization_id: org.id).payload[:context]
    end

    it "scopes stale_alerts to the tenant via site.organization_id" do
      match_a = create(:signal_rule_match,
                       site: site_a, workflow_status: "unacknowledged",
                       confidence: 0.4, fired_at: 6.hours.ago, auto_task: false)
      match_b = create(:signal_rule_match,
                       site: site_b, workflow_status: "unacknowledged",
                       confidence: 0.4, fired_at: 6.hours.ago, auto_task: false)

      ids = assemble_for(org_a)[:stale_alerts].map { |a| a[:id] }
      expect(ids).to include(match_a.id)
      expect(ids).not_to include(match_b.id)
    end

    it "scopes high_conf_alerts to the tenant" do
      match_a = create(:signal_rule_match,
                       site: site_a, workflow_status: "unacknowledged",
                       confidence: 0.9, fired_at: 30.minutes.ago, auto_task: false)
      match_b = create(:signal_rule_match,
                       site: site_b, workflow_status: "unacknowledged",
                       confidence: 0.9, fired_at: 30.minutes.ago, auto_task: false)

      ids = assemble_for(org_a)[:high_conf_alerts].map { |a| a[:id] }
      expect(ids).to include(match_a.id)
      expect(ids).not_to include(match_b.id)
    end

    it "scopes open_incidents via site.organization_id" do
      incident_a = create(:incident, site: site_a, status: "open", severity: "high")
      incident_b = create(:incident, site: site_b, status: "open", severity: "high")

      ids = assemble_for(org_a)[:open_incidents].map { |i| i[:id] }
      expect(ids).to include(incident_a.id)
      expect(ids).not_to include(incident_b.id)
    end

    it "scopes open_incidents via AO.organization_id when site is nil" do
      ao_a = create(:area_of_operation, organization: org_a)
      ao_b = create(:area_of_operation, organization: org_b)
      incident_a = create(:incident, site: nil, area_of_operation: ao_a, status: "open", severity: "high")
      incident_b = create(:incident, site: nil, area_of_operation: ao_b, status: "open", severity: "high")

      ids = assemble_for(org_a)[:open_incidents].map { |i| i[:id] }
      expect(ids).to include(incident_a.id)
      expect(ids).not_to include(incident_b.id)
    end

    it "scopes overdue_tasks to the tenant" do
      task_a = create(:task, site: site_a, workflow_status: "in_progress", updated_at: 3.days.ago)
      task_b = create(:task, site: site_b, workflow_status: "in_progress", updated_at: 3.days.ago)

      ids = assemble_for(org_a)[:overdue_tasks].map { |t| t[:id] }
      expect(ids).to include(task_a.id)
      expect(ids).not_to include(task_b.id)
    end

    it "scopes flaggable_sites and risk_snapshots via site.organization_id" do
      site_a.update!(flagged_at: nil)
      site_b.update!(flagged_at: nil)
      create(:site_risk_snapshot, site: site_a, score: 88, recorded_at: 1.hour.ago)
      create(:site_risk_snapshot, site: site_b, score: 92, recorded_at: 1.hour.ago)

      ctx = assemble_for(org_a)
      flaggable_ids = ctx[:flaggable_sites].map { |s| s[:id] }
      expect(flaggable_ids).to include(site_a.id)
      expect(flaggable_ids).not_to include(site_b.id)

      snapshot_site_ids = ctx[:risk_snapshots].map { |s| s[:site_id] }
      expect(snapshot_site_ids).to include(site_a.id)
      expect(snapshot_site_ids).not_to include(site_b.id)
    end

    it "scopes bulk_triage_sites to the tenant" do
      described_class::BULK_TRIAGE_THRESHOLD.times do
        create(:signal_rule_match,
               site: site_a, workflow_status: "unacknowledged",
               fired_at: 1.hour.ago, auto_task: false)
        create(:signal_rule_match,
               site: site_b, workflow_status: "unacknowledged",
               fired_at: 1.hour.ago, auto_task: false)
      end

      ids = assemble_for(org_a)[:bulk_triage_sites].map { |s| s[:site_id] }
      expect(ids).to include(site_a.id)
      expect(ids).not_to include(site_b.id)
    end

    it "scopes posture_by_site_id to the tenant" do
      ao_a = create(:area_of_operation, organization: org_a, posture: "defensive")
      ao_b = create(:area_of_operation, organization: org_b, posture: "observe")
      site_a.update!(area_of_operation: ao_a)
      site_b.update!(area_of_operation: ao_b)

      postures = assemble_for(org_a)[:posture_by_site_id]
      expect(postures.keys).to include(site_a.id)
      expect(postures.keys).not_to include(site_b.id)
    end

    it "scopes asset_availability and available_assets via home_site.organization_id" do
      asset_a = create(:asset, status: "available", home_site: site_a)
      _asset_b = create(:asset, status: "available", home_site: site_b)
      _orphan  = create(:asset, status: "available", home_site: nil)

      ctx = assemble_for(org_a)
      expect(ctx[:asset_availability][:available]).to eq(1)
      expect(ctx[:available_assets].map { |a| a[:id] }).to eq([asset_a.id])
    end

    it "scopes unassigned_high_priority_tasks to the tenant" do
      task_a = create(:task, site: site_a, priority: "critical", asset_id: nil)
      task_b = create(:task, site: site_b, priority: "critical", asset_id: nil)

      ids = assemble_for(org_a)[:unassigned_high_priority_tasks].map { |t| t[:id] }
      expect(ids).to include(task_a.id)
      expect(ids).not_to include(task_b.id)
    end

    it "preserves global reads when organization_id is nil" do
      create(:asset, status: "available", home_site: site_a)
      create(:asset, status: "available", home_site: site_b)

      ctx = described_class.call.payload[:context]
      expect(ctx[:asset_availability][:available]).to eq(2)
    end
  end
end
