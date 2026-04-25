require "rails_helper"

RSpec.describe Mfa::VerificationService do
  let(:user) { create(:user, :commander) }
  let(:enrollment) do
    result = Mfa::EnrollmentService.begin_enrollment(user)
    Mfa::EnrollmentService.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now)
    user.reload
    result
  end

  describe ".verify with TOTP code" do
    it "succeeds for the current TOTP step" do
      enrollment
      # totp_last_used_at is now stamped at the confirm step. Travel
      # one full step forward so the same code isn't rejected by the
      # replay guard below.
      travel 31.seconds do
        live_code = ROTP::TOTP.new(enrollment.secret).now
        result = described_class.verify(user: user.reload, totp_code: live_code)

        expect(result.ok?).to be(true)
        expect(result.error).to be_nil
        expect(result.used_recovery_code).to be(false)
      end
    end

    it "fails for a wrong code" do
      enrollment
      travel 31.seconds do
        result = described_class.verify(user: user.reload, totp_code: "000000")

        expect(result.ok?).to be(false)
        expect(result.error).to eq("Invalid TOTP code")
      end
    end

    it "rejects a replayed code (same TOTP step)" do
      enrollment
      travel 31.seconds do
        live_code = ROTP::TOTP.new(enrollment.secret).now
        first  = described_class.verify(user: user.reload, totp_code: live_code)
        second = described_class.verify(user: user.reload, totp_code: live_code)

        expect(first.ok?).to be(true)
        expect(second.ok?).to be(false), "second verify in the same step must fail"
        expect(second.error).to eq("Invalid TOTP code")
      end
    end

    it "fails when MFA is not enabled for the user" do
      result = described_class.verify(user: user, totp_code: "123456")

      expect(result.ok?).to be(false)
      expect(result.error).to eq("MFA not enabled for user")
    end
  end

  describe ".verify with recovery code" do
    it "succeeds and marks the matched code as used" do
      enrollment
      code = enrollment.recovery_codes.first

      result = described_class.verify(user: user.reload, recovery_code: code)

      expect(result.ok?).to be(true)
      expect(result.used_recovery_code).to be(true)
      used_row = user.mfa_recovery_codes.find { |rc| rc.matches?(code) }
      expect(used_row).to be_nil # already marked used so #matches? returns false
      expect(user.mfa_recovery_codes.used.count).to eq(1)
    end

    it "rejects an already-used recovery code" do
      enrollment
      code = enrollment.recovery_codes.first
      described_class.verify(user: user.reload, recovery_code: code)

      result = described_class.verify(user: user.reload, recovery_code: code)
      expect(result.ok?).to be(false)
    end

    it "rejects a recovery code that was never issued" do
      enrollment
      result = described_class.verify(user: user.reload, recovery_code: "fake0-fake0-fake0-fake0")

      expect(result.ok?).to be(false)
      expect(result.error).to eq("Invalid recovery code")
    end

    it "is case-insensitive on the recovery code (operator-friendly)" do
      enrollment
      code = enrollment.recovery_codes.first

      result = described_class.verify(user: user.reload, recovery_code: code.upcase)
      expect(result.ok?).to be(true)
    end
  end

  describe ".verify with neither code" do
    it "returns 'MFA code required' when MFA is enabled and no code is supplied" do
      enrollment
      result = described_class.verify(user: user.reload)

      expect(result.ok?).to be(false)
      expect(result.error).to eq("MFA code required")
    end
  end

  describe ".verify when both codes are supplied" do
    it "prefers the TOTP code (recovery code is not consumed)" do
      enrollment
      code = enrollment.recovery_codes.first
      travel 31.seconds do
        live_code = ROTP::TOTP.new(enrollment.secret).now
        result = described_class.verify(
          user:          user.reload,
          totp_code:     live_code,
          recovery_code: code,
        )

        expect(result.ok?).to be(true)
        expect(result.used_recovery_code).to be(false)
        # Recovery code was NOT consumed
        expect(user.mfa_recovery_codes.used.count).to eq(0)
      end
    end
  end

  # Audit-trail proofs (Tranche 3B Codex P2 fix-forward, 2026-04-25):
  # the durable forensic record of MFA verification lives in
  # audit_events (chain-hashed per ADR-010), not in the
  # mfa_recovery_codes side table. Emitted on success only —
  # failed verifies do not emit (intrusion-detection events live
  # in a separate tranche).
  describe "audit trail" do
    it "emits an mfa.code_used event with used_recovery_code=false on TOTP success" do
      enrollment
      travel 31.seconds do
        live_code = ROTP::TOTP.new(enrollment.secret).now

        expect {
          described_class.verify(user: user.reload, totp_code: live_code)
        }.to change {
          AuditEvent.where(entity_type: "User", entity_id: user.id, event_type: "mfa.code_used").count
        }.by(1)

        ev = AuditEvent.where(event_type: "mfa.code_used", entity_id: user.id).order(:occurred_at).last
        expect(ev.metadata).to eq("used_recovery_code" => false)
        expect(ev.after_snapshot["used_recovery_code"]).to be(false)
        expect(ev.after_snapshot["verified_at"]).to be_present
      end
    end

    it "emits an mfa.code_used event with used_recovery_code=true on recovery-code success" do
      code = enrollment.recovery_codes.first

      expect {
        described_class.verify(user: user.reload, recovery_code: code)
      }.to change {
        AuditEvent.where(event_type: "mfa.code_used", entity_id: user.id).count
      }.by(1)

      ev = AuditEvent.where(event_type: "mfa.code_used", entity_id: user.id).order(:occurred_at).last
      expect(ev.metadata).to eq("used_recovery_code" => true)
      expect(ev.after_snapshot["used_recovery_code"]).to be(true)
    end

    it "does not emit an mfa.code_used event on a failed verify" do
      enrollment
      travel 31.seconds do
        expect {
          described_class.verify(user: user.reload, totp_code: "000000")
        }.not_to change {
          AuditEvent.where(event_type: "mfa.code_used", entity_id: user.id).count
        }
      end
    end

    it "does not emit a duplicate mfa.code_used when the second of two concurrent verifies loses the race" do
      enrollment
      travel 31.seconds do
        code   = ROTP::TOTP.new(enrollment.secret).now
        user_a = User.find(user.id)
        user_b = User.find(user.id)

        described_class.verify(user: user_a, totp_code: code)
        described_class.verify(user: user_b, totp_code: code)

        # Only the winner of the conditional UPDATE-WHERE race
        # gets a code_used event. The loser failed before the
        # audit event would emit.
        expect(AuditEvent.where(event_type: "mfa.code_used", entity_id: user.id).count).to eq(1)
      end
    end
  end

  # Atomicity proofs (Tranche 3B Codex P1 fix-forward, 2026-04-25):
  # two AR User instances loaded from the same DB row simulate
  # concurrent requests. Each instance carries its own in-memory
  # snapshot of totp_last_used_at / mfa_recovery_codes — the atomic
  # guarantee lives in the conditional UPDATE-WHERE evaluated
  # against committed DB state, not in-memory state. The first
  # verify commits; the second's WHERE clause sees the new DB
  # value and update_all returns 0 rows → failure.
  describe "atomicity under concurrent requests" do
    it "TOTP: rejects the second of two concurrent verifies of the same code" do
      enrollment
      travel 31.seconds do
        code   = ROTP::TOTP.new(enrollment.secret).now
        user_a = User.find(user.id)
        user_b = User.find(user.id)

        result_a = described_class.verify(user: user_a, totp_code: code)
        result_b = described_class.verify(user: user_b, totp_code: code)

        successes = [ result_a, result_b ].count(&:ok?)
        expect(successes).to eq(1),
          "exactly one of two concurrent TOTP verifies must succeed; " \
          "got result_a=#{result_a.ok?} result_b=#{result_b.ok?}"
      end
    end

    it "TOTP: the loser receives the standard 'Invalid TOTP code' error (no race-state leak)" do
      enrollment
      travel 31.seconds do
        code   = ROTP::TOTP.new(enrollment.secret).now
        user_a = User.find(user.id)
        user_b = User.find(user.id)

        described_class.verify(user: user_a, totp_code: code)
        loser = described_class.verify(user: user_b, totp_code: code)

        expect(loser.ok?).to be(false)
        expect(loser.error).to eq("Invalid TOTP code")
      end
    end

    it "recovery code: rejects the second of two concurrent redemptions of the same code" do
      code   = enrollment.recovery_codes.first
      user_a = User.find(user.id)
      user_b = User.find(user.id)

      result_a = described_class.verify(user: user_a, recovery_code: code)
      result_b = described_class.verify(user: user_b, recovery_code: code)

      successes = [ result_a, result_b ].count(&:ok?)
      expect(successes).to eq(1),
        "exactly one of two concurrent recovery redemptions must succeed; " \
        "got result_a=#{result_a.ok?} result_b=#{result_b.ok?}"
    end

    it "recovery code: only one used_at row exists after a concurrent attempt" do
      code   = enrollment.recovery_codes.first
      user_a = User.find(user.id)
      user_b = User.find(user.id)

      described_class.verify(user: user_a, recovery_code: code)
      described_class.verify(user: user_b, recovery_code: code)

      # The matching code row has been redeemed exactly once. The
      # other 9 codes remain active.
      expect(user.reload.mfa_recovery_codes.used.count).to eq(1)
      expect(user.mfa_recovery_codes.active.count).to eq(9)
    end
  end
end
