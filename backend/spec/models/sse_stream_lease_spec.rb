require "rails_helper"

RSpec.describe SseStreamLease, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:sse_stream_lease)).to be_valid
    end

    it "rejects invalid stream_name" do
      expect(build(:sse_stream_lease, stream_name: "bogus")).not_to be_valid
    end

    it "accepts all valid stream names" do
      SseStreamLease::STREAM_NAMES.each do |name|
        expect(build(:sse_stream_lease, stream_name: name)).to be_valid
      end
    end

    %i[remote_ip lease_key expires_at].each do |field|
      it "requires #{field}" do
        record = build(:sse_stream_lease, field => nil)
        expect(record).not_to be_valid
        expect(record.errors[field]).to be_present
      end
    end

    it "enforces lease_key uniqueness" do
      create(:sse_stream_lease, lease_key: "dup-key")
      dup = build(:sse_stream_lease, lease_key: "dup-key")
      expect(dup).not_to be_valid
      expect(dup.errors[:lease_key]).to be_present
    end
  end

  # ── Scopes ──────────────────────────────────────────────────────────────────

  describe ".active_at" do
    it "returns leases that have not expired at the given time" do
      active  = create(:sse_stream_lease, expires_at: 10.minutes.from_now)
      expired = create(:sse_stream_lease, expires_at: 10.minutes.ago)

      results = described_class.active_at(Time.current)
      expect(results).to include(active)
      expect(results).not_to include(expired)
    end
  end

  describe ".expired_at" do
    it "returns leases that have expired at the given time" do
      active  = create(:sse_stream_lease, expires_at: 10.minutes.from_now)
      expired = create(:sse_stream_lease, expires_at: 10.minutes.ago)

      results = described_class.expired_at(Time.current)
      expect(results).to include(expired)
      expect(results).not_to include(active)
    end
  end
end
