require "rails_helper"

RSpec.describe UserSession do
  describe "validations" do
    subject { build(:user_session) }

    it { is_expected.to be_valid }

    it "requires jti" do
      subject.jti = nil
      expect(subject).not_to be_valid
    end

    it "enforces jti uniqueness" do
      existing = create(:user_session)
      subject.jti = existing.jti
      expect(subject).not_to be_valid
    end

    it "requires expires_at" do
      subject.expires_at = nil
      expect(subject).not_to be_valid
    end

    it "requires last_seen_at" do
      subject.last_seen_at = nil
      expect(subject).not_to be_valid
    end
  end

  describe "scopes" do
    let!(:active_session)  { create(:user_session, revoked_at: nil, expires_at: 1.hour.from_now) }
    let!(:revoked_session) { create(:user_session, revoked_at: Time.current) }
    let!(:expired_session) { create(:user_session, revoked_at: nil, expires_at: 1.hour.ago) }

    describe ".active" do
      it "returns only non-revoked, non-expired sessions" do
        expect(described_class.active).to include(active_session)
        expect(described_class.active).not_to include(revoked_session, expired_session)
      end
    end
  end

  describe ".issue!" do
    let(:user) { create(:user, :commander) }
    let(:token_payload) { { jti: SecureRandom.uuid, exp: 24.hours.from_now.to_i } }
    let(:request) do
      instance_double(ActionDispatch::Request,
        user_agent: "Test Browser/1.0",
        remote_ip: "192.168.1.1",
      )
    end

    it "creates a session from token payload" do
      session = described_class.issue!(user: user, token_payload: token_payload, request: request)

      expect(session).to be_persisted
      expect(session.user).to eq(user)
      expect(session.jti).to eq(token_payload[:jti])
      expect(session.user_agent).to eq("Test Browser/1.0")
      expect(session.ip_address).to eq("192.168.1.1")
      expect(session.last_seen_at).to be_present
    end
  end

  describe "#touch_if_stale!" do
    let(:session) { create(:user_session, last_seen_at: 10.minutes.ago) }

    it "updates last_seen_at when stale" do
      expect { session.touch_if_stale! }
        .to change { session.reload.last_seen_at }
    end

    it "does not update when fresh" do
      session.update_column(:last_seen_at, 1.minute.ago)
      original = session.last_seen_at

      session.touch_if_stale!
      expect(session.reload.last_seen_at).to eq(original)
    end
  end

  describe "#revoke!" do
    let(:session) { create(:user_session) }
    let(:admin)   { create(:user, :commander) }

    it "sets revocation fields" do
      session.revoke!(actor: admin, reason: "suspicious")

      session.reload
      expect(session.revoked_at).to be_present
      expect(session.revoked_by).to eq(admin)
      expect(session.revoke_reason).to eq("suspicious")
    end

    it "creates a RevokedJwt record" do
      expect { session.revoke!(actor: admin) }
        .to change(RevokedJwt, :count).by(1)

      expect(RevokedJwt.find_by(jti: session.jti)).to be_present
    end

    it "is idempotent — does not re-revoke" do
      session.revoke!(actor: admin)
      original_revoked_at = session.revoked_at

      session.revoke!(actor: admin, reason: "again")
      expect(session.reload.revoked_at).to eq(original_revoked_at)
    end
  end

  describe ".revoke_scope!" do
    let(:user)    { create(:user, :commander) }
    let!(:s1) { create(:user_session, user: user) }
    let!(:s2) { create(:user_session, user: user) }
    let!(:s3) { create(:user_session, user: user) }

    it "revokes all sessions in scope" do
      described_class.revoke_scope!(
        described_class.where(user: user),
        actor: user,
        reason: "logout_all",
      )

      expect(described_class.where(user: user).pluck(:revoked_at).compact.size).to eq(3)
    end

    it "excludes keep_jti from revocation" do
      described_class.revoke_scope!(
        described_class.where(user: user),
        actor: user,
        reason: "logout_others",
        keep_jti: s1.jti,
      )

      expect(s1.reload.revoked_at).to be_nil
      expect(s2.reload.revoked_at).to be_present
      expect(s3.reload.revoked_at).to be_present
    end
  end
end
