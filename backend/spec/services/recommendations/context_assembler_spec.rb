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
end
