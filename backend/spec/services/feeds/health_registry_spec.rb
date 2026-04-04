require "rails_helper"

RSpec.describe Feeds::HealthRegistry do
  after { described_class.reset! }

  describe ".record" do
    it "persists feed health as an OperationalStatus" do
      expect {
        described_class.record(feed: "acled", status: "ok", count: 42)
      }.to change(OperationalStatus, :count).by(1)

      record = OperationalStatus.find_by(category: "feed_health", key: "acled")
      expect(record.payload).to include("status" => "ok", "count" => 42)
    end

    it "upserts on repeated calls for the same feed" do
      described_class.record(feed: "acled", status: "ok", count: 10)
      described_class.record(feed: "acled", status: "error", count: 0)

      expect(OperationalStatus.where(category: "feed_health", key: "acled").count).to eq(1)
      expect(OperationalStatus.find_by(key: "acled").payload).to include("status" => "error")
    end
  end

  describe ".all" do
    it "returns all feed health entries as symbolized hashes" do
      described_class.record(feed: "acled", status: "ok")
      described_class.record(feed: "firms", status: "ok")

      results = described_class.all
      expect(results.length).to eq(2)
      expect(results.first).to be_a(Hash)
      expect(results.first.keys.first).to be_a(Symbol)
    end
  end

  describe ".reset!" do
    it "removes all feed health records" do
      described_class.record(feed: "acled", status: "ok")
      described_class.reset!

      expect(OperationalStatus.where(category: "feed_health").count).to eq(0)
    end

    it "does not remove records from other categories" do
      described_class.record(feed: "acled", status: "ok")
      OperationalStatus.record!(category: "job_health", key: "test_job", payload: { ok: true })

      described_class.reset!

      expect(OperationalStatus.where(category: "job_health").count).to eq(1)
    end
  end
end
