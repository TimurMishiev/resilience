require "rails_helper"

RSpec.describe Mfa::EnrollmentService do
  let(:user) { create(:user, :commander, email: "ops@resilience.test") }

  describe ".begin_enrollment" do
    it "generates a fresh ROTP secret and stores it encrypted" do
      result = described_class.begin_enrollment(user)

      expect(result.secret).to match(/\A[A-Z2-7]+\z/) # base32 alphabet
      expect(result.secret.length).to be >= 16
      user.reload
      expect(user.totp_secret_ciphertext).not_to be_blank
      expect(user.totp_secret).to eq(result.secret)
      # Plaintext must NOT be in the persisted bytea — round-trip via cipher only.
      expect(user.totp_secret_ciphertext.to_s).not_to include(result.secret)
    end

    it "produces a provisioning URI tied to the issuer + user email" do
      result = described_class.begin_enrollment(user)

      expect(result.provisioning_uri).to start_with("otpauth://totp/")
      expect(result.provisioning_uri).to include("issuer=Resilience")
      expect(result.provisioning_uri).to include(URI.encode_www_form_component(user.email))
    end

    it "generates 10 unique recovery codes in the documented dash-separated format" do
      result = described_class.begin_enrollment(user)

      expect(result.recovery_codes.size).to eq(10)
      expect(result.recovery_codes.uniq.size).to eq(10)
      result.recovery_codes.each do |code|
        expect(code).to match(/\A[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}\z/)
        # Ambiguous chars must not appear (i/l/o/0/1).
        expect(code).not_to match(/[ilo01]/)
      end
    end

    it "persists 10 BCrypt-hashed recovery codes that match the plaintext" do
      result = described_class.begin_enrollment(user)
      hashes = user.mfa_recovery_codes.pluck(:code_hash)

      expect(hashes.size).to eq(10)
      result.recovery_codes.each do |plaintext|
        matching = user.mfa_recovery_codes.find { |rc| rc.matches?(plaintext) }
        expect(matching).not_to be_nil, "expected a recovery row to match #{plaintext}"
      end
    end

    it "leaves totp_enabled? false until confirmation" do
      described_class.begin_enrollment(user)
      expect(user.reload.totp_enabled?).to be(false)
    end

    it "rotates the secret + recovery codes when re-enrolling, invalidating any prior codes" do
      first  = described_class.begin_enrollment(user)
      second = described_class.begin_enrollment(user)

      expect(second.secret).not_to eq(first.secret)
      expect(user.reload.totp_secret).to eq(second.secret)

      # Old plaintext codes no longer match any persisted hash.
      first.recovery_codes.each do |stale|
        expect(user.mfa_recovery_codes.any? { |rc| rc.matches?(stale) }).to be(false)
      end
      # New codes do.
      second.recovery_codes.each do |fresh|
        expect(user.mfa_recovery_codes.any? { |rc| rc.matches?(fresh) }).to be(true)
      end
    end
  end

  describe ".confirm_enrollment" do
    it "enables MFA and stamps totp_enabled_at when the code matches the secret's current step" do
      result = described_class.begin_enrollment(user)
      live_code = ROTP::TOTP.new(result.secret).now

      ok = described_class.confirm_enrollment(user, live_code)

      expect(ok).to be(true)
      expect(user.reload.totp_enabled?).to be(true)
      expect(user.totp_enabled_at).to be_within(2.seconds).of(Time.current)
      expect(user.totp_last_used_at).not_to be_nil
    end

    it "returns false on a wrong code without flipping totp_enabled_at" do
      described_class.begin_enrollment(user)
      ok = described_class.confirm_enrollment(user, "000000")

      expect(ok).to be(false)
      expect(user.reload.totp_enabled_at).to be_nil
    end

    it "returns false if no enrollment was started" do
      ok = described_class.confirm_enrollment(user, "123456")
      expect(ok).to be(false)
    end

    it "returns false if MFA is already enabled (idempotency / replay prevention)" do
      result    = described_class.begin_enrollment(user)
      live_code = ROTP::TOTP.new(result.secret).now
      described_class.confirm_enrollment(user, live_code)

      ok = described_class.confirm_enrollment(user, live_code)
      expect(ok).to be(false)
    end
  end

  describe ".disable!" do
    it "clears the secret + timestamps + recovery codes" do
      result = described_class.begin_enrollment(user)
      described_class.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now)

      described_class.disable!(user)
      user.reload

      expect(user.totp_secret).to be_nil
      expect(user.totp_enabled?).to be(false)
      expect(user.totp_enabled_at).to be_nil
      expect(user.totp_last_used_at).to be_nil
      expect(user.mfa_recovery_codes).to be_empty
    end
  end

  # Audit-trail proofs (Tranche 3B Codex P2 fix-forward, 2026-04-25):
  # the durable forensic record of MFA state changes lives in
  # audit_events (chain-hashed per ADR-010), not in the
  # mfa_recovery_codes side table. These specs lock the events that
  # callers / acquirers / auditors rely on.
  describe "audit trail" do
    it "emits an mfa.enabled event on successful confirmation" do
      result = described_class.begin_enrollment(user)
      live_code = ROTP::TOTP.new(result.secret).now

      expect {
        described_class.confirm_enrollment(user, live_code)
      }.to change {
        AuditEvent.where(entity_type: "User", entity_id: user.id, event_type: "mfa.enabled").count
      }.by(1)

      ev = AuditEvent.where(event_type: "mfa.enabled", entity_id: user.id).order(:occurred_at).last
      expect(ev.before_snapshot).to eq("totp_enabled" => false)
      expect(ev.after_snapshot["totp_enabled"]).to be(true)
      expect(ev.after_snapshot["totp_enabled_at"]).to be_present
    end

    it "does not emit mfa.enabled on a failed confirmation" do
      described_class.begin_enrollment(user)

      expect {
        described_class.confirm_enrollment(user, "000000")
      }.not_to change {
        AuditEvent.where(event_type: "mfa.enabled", entity_id: user.id).count
      }
    end

    it "emits an mfa.disabled event on disable!" do
      result = described_class.begin_enrollment(user)
      described_class.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now)

      expect {
        described_class.disable!(user)
      }.to change {
        AuditEvent.where(entity_type: "User", entity_id: user.id, event_type: "mfa.disabled").count
      }.by(1)

      ev = AuditEvent.where(event_type: "mfa.disabled", entity_id: user.id).order(:occurred_at).last
      expect(ev.before_snapshot).to eq("totp_enabled" => true)
      expect(ev.after_snapshot).to eq("totp_enabled" => false)
    end

    it "records the explicit actor on the audit event when provided (e.g. self-service path)" do
      result = described_class.begin_enrollment(user)
      described_class.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now, actor: user)

      ev = AuditEvent.where(event_type: "mfa.enabled", entity_id: user.id).order(:occurred_at).last
      expect(ev.actor).to eq(user.email)
    end
  end
end
