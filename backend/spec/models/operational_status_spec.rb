require "rails_helper"

RSpec.describe OperationalStatus, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:operational_status)).to be_valid
    end

    it "requires category" do
      expect(build(:operational_status, category: nil)).not_to be_valid
    end

    it "requires key" do
      expect(build(:operational_status, key: nil)).not_to be_valid
    end

    it "requires payload" do
      expect(build(:operational_status, payload: nil)).not_to be_valid
    end

    it "rejects invalid category" do
      expect(build(:operational_status, category: "invalid")).not_to be_valid
    end

    it "accepts all valid categories" do
      OperationalStatus::CATEGORIES.each do |cat|
        expect(build(:operational_status, category: cat)).to be_valid
      end
    end

    it "enforces key uniqueness within category" do
      create(:operational_status, category: "feed_health", key: "acled")
      dup = build(:operational_status, category: "feed_health", key: "acled")
      expect(dup).not_to be_valid
      expect(dup.errors[:key]).to be_present
    end

    it "allows the same key in different categories" do
      create(:operational_status, category: "feed_health", key: "shared_key")
      other = build(:operational_status, category: "job_health", key: "shared_key")
      expect(other).to be_valid
    end
  end

  # ── .record! (upsert) ──────────────────────────────────────────────────────

  describe ".record!" do
    it "inserts a new record" do
      expect {
        described_class.record!(category: "feed_health", key: "acled", payload: { status: "ok" })
      }.to change(described_class, :count).by(1)
    end

    it "upserts on duplicate category+key" do
      described_class.record!(category: "feed_health", key: "acled", payload: { status: "ok" })
      expect {
        described_class.record!(category: "feed_health", key: "acled", payload: { status: "error" })
      }.not_to change(described_class, :count)

      record = described_class.find_by(category: "feed_health", key: "acled")
      expect(record.payload).to include("status" => "error")
    end
  end

  # ── Scopes ──────────────────────────────────────────────────────────────────

  describe ".for_category" do
    it "returns records for the given category ordered by key" do
      create(:operational_status, category: "feed_health", key: "z_feed")
      create(:operational_status, category: "feed_health", key: "a_feed")
      create(:operational_status, category: "job_health", key: "other")

      results = described_class.for_category("feed_health")
      expect(results.pluck(:key)).to eq(%w[a_feed z_feed])
    end
  end
end
