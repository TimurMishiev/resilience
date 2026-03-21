require "rails_helper"

RSpec.describe Risk::SnapshotJob, type: :job do
  let(:job) { described_class.new }

  let!(:site_a) { create(:site) }
  let!(:site_b) { create(:site) }

  describe "#perform" do
    it "creates one snapshot per active site" do
      expect { job.perform }.to change(SiteRiskSnapshot, :count).by(2)
    end

    it "does not snapshot inactive sites" do
      inactive = create(:site, :inactive)
      job.perform
      ids = SiteRiskSnapshot.pluck(:site_id)
      expect(ids).not_to include(inactive.id)
    end

    it "sets score within 0–100" do
      job.perform
      SiteRiskSnapshot.all.each do |snap|
        expect(snap.score).to be_between(0, 100)
      end
    end

    it "sets a valid risk_level on every snapshot" do
      job.perform
      levels = SiteRiskSnapshot.pluck(:risk_level).uniq
      expect(levels).to all(be_in(%w[low moderate high critical]))
    end

    it "sets non-negative component values" do
      job.perform
      SiteRiskSnapshot.all.each do |snap|
        expect(snap.alert_pressure).to be >= 0
        expect(snap.task_health).to   be >= 0
        expect(snap.signal_density).to be >= 0
      end
    end

    it "sets recorded_at to approximately now" do
      job.perform
      SiteRiskSnapshot.all.each do |snap|
        expect(snap.recorded_at).to be_within(5.seconds).of(Time.current)
      end
    end

    context "when called twice" do
      it "creates two independent snapshots per site" do
        expect { 2.times { job.perform } }.to change(SiteRiskSnapshot, :count).by(4)
      end
    end

    context "with high-risk conditions" do
      before do
        # Create open, high-confidence rule matches for site_a to push up alert pressure
        3.times do
          create(:signal_rule_match,
                 site:            site_a,
                 confidence:      0.9,
                 workflow_status: "unacknowledged",
                 fired_at:        1.hour.ago)
        end
      end

      it "reflects alert pressure in the snapshot" do
        job.perform
        snap = SiteRiskSnapshot.find_by(site: site_a)
        expect(snap.alert_pressure).to be > 0
      end
    end

    context "pruning" do
      it "prunes snapshots older than 90 days" do
        old = create(:site_risk_snapshot, site: site_a, recorded_at: 91.days.ago)
        job.perform
        expect(SiteRiskSnapshot.find_by(id: old.id)).to be_nil
      end

      it "keeps snapshots within the retention window" do
        recent = create(:site_risk_snapshot, site: site_a, recorded_at: 89.days.ago)
        job.perform
        expect(SiteRiskSnapshot.find_by(id: recent.id)).not_to be_nil
      end
    end
  end
end
