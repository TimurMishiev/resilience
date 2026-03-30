require "rails_helper"

RSpec.describe Sse::LeaseCleanupJob, type: :job do
  let(:user) { create(:user) }

  def build_lease(expires_at:)
    SseStreamLease.create!(
      user: user,
      stream_name: "events",
      remote_ip: "127.0.0.1",
      lease_key: SecureRandom.uuid,
      expires_at: expires_at,
    )
  end

  describe "#perform" do
    it "deletes expired leases and keeps active ones" do
      expired = build_lease(expires_at: 1.minute.ago)
      active  = build_lease(expires_at: 3.minutes.from_now)

      described_class.new.perform

      expect(SseStreamLease.find_by(id: expired.id)).to be_nil
      expect(SseStreamLease.find_by(id: active.id)).to be_present
    end

    it "handles an empty table without error" do
      expect { described_class.new.perform }.not_to raise_error
    end
  end
end
