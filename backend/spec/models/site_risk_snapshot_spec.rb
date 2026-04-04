require "rails_helper"

RSpec.describe SiteRiskSnapshot, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:site_risk_snapshot)).to be_valid
    end

    %i[score risk_level alert_pressure task_health signal_density recorded_at].each do |field|
      it "requires #{field}" do
        record = build(:site_risk_snapshot, field => nil)
        expect(record).not_to be_valid
        expect(record.errors[field]).to be_present
      end
    end

    it "rejects score below 0" do
      expect(build(:site_risk_snapshot, score: -1)).not_to be_valid
    end

    it "rejects score above 100" do
      expect(build(:site_risk_snapshot, score: 101)).not_to be_valid
    end

    it "requires integer score" do
      expect(build(:site_risk_snapshot, score: 50.5)).not_to be_valid
    end

    it "rejects invalid risk_level" do
      expect(build(:site_risk_snapshot, risk_level: "extreme")).not_to be_valid
    end

    it "accepts all valid risk levels" do
      SiteRiskSnapshot::VALID_LEVELS.each do |level|
        expect(build(:site_risk_snapshot, risk_level: level)).to be_valid
      end
    end

    it "rejects negative alert_pressure" do
      expect(build(:site_risk_snapshot, alert_pressure: -1)).not_to be_valid
    end

    it "rejects negative task_health" do
      expect(build(:site_risk_snapshot, task_health: -1)).not_to be_valid
    end

    it "rejects negative signal_density" do
      expect(build(:site_risk_snapshot, signal_density: -1)).not_to be_valid
    end
  end

  # ── Scopes ──────────────────────────────────────────────────────────────────

  describe ".within_days" do
    it "returns snapshots within the given window" do
      site = create(:site)
      recent = create(:site_risk_snapshot, site: site, recorded_at: 1.day.ago)
      old    = create(:site_risk_snapshot, site: site, recorded_at: 10.days.ago)

      results = described_class.within_days(7)
      expect(results).to include(recent)
      expect(results).not_to include(old)
    end
  end

  # ── .prune_old! ─────────────────────────────────────────────────────────────

  describe ".prune_old!" do
    it "removes snapshots older than RETENTION_DAYS" do
      site = create(:site)
      recent = create(:site_risk_snapshot, site: site, recorded_at: 30.days.ago)
      old    = create(:site_risk_snapshot, site: site, recorded_at: 91.days.ago)

      described_class.prune_old!

      expect(described_class.exists?(recent.id)).to be true
      expect(described_class.exists?(old.id)).to be false
    end
  end
end
