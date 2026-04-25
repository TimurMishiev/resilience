require "rotp"

module Mfa
  # Begins an MFA enrollment for a user.
  #
  # Generates a fresh TOTP secret + 10 single-use BCrypt-hashed
  # recovery codes, persists them on the user record (replacing any
  # previous draft enrollment), and returns the plaintext
  # provisioning URI + plaintext recovery codes to the caller. The
  # secret + codes are shown to the user exactly once — after this
  # response, only their hashed forms remain in the database.
  #
  # The user is NOT considered "MFA enabled" until they confirm by
  # submitting a valid TOTP code via Mfa::EnrollmentService.confirm —
  # see User#totp_enabled? (driven by totp_enabled_at). This split
  # prevents a user from locking themselves out of their account by
  # generating a secret they can't actually scan into their
  # authenticator app.
  #
  # Re-enrolling overwrites the previous secret AND invalidates any
  # outstanding recovery codes — both are part of the same root of
  # trust and must rotate together.
  class EnrollmentService
    ISSUER = "Resilience"
    RECOVERY_CODE_COUNT = 10

    # Recovery code alphabet: lowercase letters + digits, with the
    # ambiguous chars removed (i/l/o vs 1/0). 4 groups of 5 = 20
    # chars; ~120 bits at 31-char alphabet — well above the
    # collision floor for backup codes.
    RECOVERY_ALPHABET = (("a".."z").to_a + ("0".."9").to_a - %w[i l o 0 1]).freeze
    RECOVERY_GROUP_SIZE = 5
    RECOVERY_GROUP_COUNT = 4

    Result = Struct.new(:provisioning_uri, :secret, :recovery_codes, keyword_init: true)

    class << self
      def begin_enrollment(user)
        secret = ROTP::Base32.random
        codes  = Array.new(RECOVERY_CODE_COUNT) { generate_recovery_code }

        ApplicationRecord.transaction do
          user.totp_secret = secret
          # Reset enrollment state — re-enrolling invalidates the
          # previous draft and any prior recovery codes.
          user.totp_enabled_at = nil
          user.totp_last_used_at = nil
          user.save!

          # Wipe any prior codes (active or used) — the audit-log
          # trail of "this code was redeemed" is preserved on the
          # AuditEvent side, not on this side-table that is
          # rotated as a unit.
          user.mfa_recovery_codes.delete_all
          codes.each do |code|
            user.mfa_recovery_codes.create!(code_hash: BCrypt::Password.create(code))
          end
        end

        provisioning_uri = ROTP::TOTP.new(secret, issuer: ISSUER)
                                     .provisioning_uri(user.email)

        Result.new(
          provisioning_uri: provisioning_uri,
          secret:           secret,
          recovery_codes:   codes,
        )
      end

      # Confirms enrollment by verifying the first TOTP code. Sets
      # totp_enabled_at on success; returns true/false. Does not
      # mutate state on failure so the caller can retry.
      #
      # Emits an `mfa.enabled` audit event on success — the durable
      # forensic trail of "this user turned on MFA at this time"
      # lives in audit_events, which is hash-chained per ADR-010.
      # `actor` MUST be a User-like object responding to .email
      # (defaults to `user` for self-enrollment); admin-driven
      # enrollment would widen the contract in lockstep with the
      # new caller.
      def confirm_enrollment(user, totp_code, actor: nil)
        return false unless user.totp_secret.present?
        return false if user.totp_enabled?

        totp = ROTP::TOTP.new(user.totp_secret, issuer: ISSUER)
        verified_at = totp.verify(totp_code.to_s.strip,
                                  drift_behind: 30,
                                  drift_ahead:  30)
        return false unless verified_at

        user.update!(
          totp_enabled_at:   Time.current,
          totp_last_used_at: Time.at(verified_at).utc,
        )

        Audit::EventWriter.write(
          actor:           (actor || user).email,
          entity_type:     "User",
          entity_id:       user.id,
          event_type:      "mfa.enabled",
          action:          "enable",
          before_snapshot: { "totp_enabled" => false },
          after_snapshot:  {
            "totp_enabled"     => true,
            "totp_enabled_at"  => user.totp_enabled_at.iso8601,
          },
          correlation_id:  SecureRandom.uuid,
        )

        true
      end

      # Disables MFA — clears the secret, the timestamps, and the
      # recovery codes. Caller is responsible for re-authenticating
      # the user (typically via current TOTP code) before invoking;
      # this service does not re-verify.
      #
      # Emits an `mfa.disabled` audit event so the durable forensic
      # trail captures who turned off the second factor and when.
      # Recovery-code rows themselves are deleted as part of the
      # rotation — the audit-event row is the persistent record,
      # not the side table.
      def disable!(user, actor: nil)
        before_state = { "totp_enabled" => user.totp_enabled? }

        ApplicationRecord.transaction do
          user.totp_secret = nil
          user.totp_enabled_at = nil
          user.totp_last_used_at = nil
          user.save!
          user.mfa_recovery_codes.delete_all
        end

        Audit::EventWriter.write(
          actor:           (actor || user).email,
          entity_type:     "User",
          entity_id:       user.id,
          event_type:      "mfa.disabled",
          action:          "disable",
          before_snapshot: before_state,
          after_snapshot:  { "totp_enabled" => false },
          correlation_id:  SecureRandom.uuid,
        )
      end

      private

      def generate_recovery_code
        groups = Array.new(RECOVERY_GROUP_COUNT) do
          Array.new(RECOVERY_GROUP_SIZE) do
            RECOVERY_ALPHABET[SecureRandom.random_number(RECOVERY_ALPHABET.size)]
          end.join
        end
        groups.join("-")
      end
    end
  end
end
