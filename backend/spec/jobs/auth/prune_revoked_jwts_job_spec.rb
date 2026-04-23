require "rails_helper"

RSpec.describe Auth::PruneRevokedJwtsJob, type: :job do
  let(:job) { described_class.new }

  describe "#perform" do
    it "deletes revocations whose expires_at has passed" do
      expired = create(:revoked_jwt, expires_at: 1.minute.ago)
      live    = create(:revoked_jwt, expires_at: 1.hour.from_now)

      expect { job.perform }.to change { RevokedJwt.count }.by(-1)
      expect(RevokedJwt.where(id: expired.id)).to be_empty
      expect(RevokedJwt.where(id: live.id)).to be_present
    end

    it "is a noop when no rows are expired" do
      create(:revoked_jwt, expires_at: 1.hour.from_now)
      expect { job.perform }.not_to change(RevokedJwt, :count)
    end

    it "prunes everything RevokedJwt.active excludes (boundary alignment)" do
      # RevokedJwt.active filters `expires_at > Time.current`, so rows at or
      # before "now" are already inactive for the auth path — they must be
      # eligible for pruning so the table cannot accumulate dead revocations.
      now = Time.current
      boundary = create(:revoked_jwt, expires_at: now)
      before   = create(:revoked_jwt, expires_at: now - 1.hour)

      job.perform

      expect(RevokedJwt.where(id: [boundary.id, before.id])).to be_empty
    end
  end
end
