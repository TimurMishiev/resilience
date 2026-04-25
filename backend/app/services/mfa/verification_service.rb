require "rotp"

module Mfa
  # Verifies a TOTP code or recovery code during login.
  #
  # Two verification paths share this service:
  #
  #   1. TOTP code (6 digits from the authenticator app). RFC 6238
  #      verification with ±30 s clock-skew tolerance. Replay
  #      protection via ROTP's `after:` parameter combined with
  #      User#totp_last_used_at — a captured code re-played within
  #      the same 30 s window will not authenticate the attacker.
  #   2. Recovery code (one of the 20-character backup codes
  #      generated at enrollment). Single-use; redemption marks the
  #      row's used_at timestamp. The audit trail of redeemed codes
  #      is preserved — never deleted — because a phished-and-
  #      redeemed code leaves a forensic mark.
  #
  # Returns a Result struct with ok?/error/used_recovery_code; the
  # `used_recovery_code` flag is also surfaced in the metadata of
  # the `mfa.code_used` audit event this service emits on success,
  # so the durable forensic trail distinguishes a normal TOTP
  # login from a recovery-code redemption (the latter is the
  # higher-signal event for incident response).
  class VerificationService
    ISSUER = Mfa::EnrollmentService::ISSUER

    Result = Struct.new(:ok?, :error, :used_recovery_code, keyword_init: true) do
      def self.success(used_recovery_code: false)
        new(ok?: true, error: nil, used_recovery_code: used_recovery_code)
      end

      def self.failure(error)
        new(ok?: false, error: error, used_recovery_code: false)
      end
    end

    class << self
      # Verifies whichever of (totp_code, recovery_code) is provided.
      # If both are provided, totp_code wins. If neither is provided
      # and the user has MFA enabled, returns failure with
      # "MFA code required". On success, emits an `mfa.code_used`
      # audit event tagged with `used_recovery_code` so the durable
      # forensic trail distinguishes the two paths.
      #
      # `actor` MUST be a User-like object responding to .email
      # (defaults to `user` for self-verification). Audit::EventWriter
      # accepts broader shapes (strings) but this service narrows
      # the contract because every call site passes a User; a
      # string actor would crash on the .email call. If a system-
      # actor or cross-tenant MFA flow ever needs to call this,
      # widen the contract here in lockstep with the new caller.
      def verify(user:, totp_code: nil, recovery_code: nil, actor: nil)
        return Result.failure("MFA not enabled for user") unless user.totp_enabled?

        result = if totp_code.present?
                   verify_totp(user, totp_code)
                 elsif recovery_code.present?
                   verify_recovery_code(user, recovery_code)
                 else
                   Result.failure("MFA code required")
                 end

        if result.ok?
          Audit::EventWriter.write(
            actor:           (actor || user).email,
            entity_type:     "User",
            entity_id:       user.id,
            event_type:      "mfa.code_used",
            action:          "verify",
            after_snapshot:  {
              "used_recovery_code" => result.used_recovery_code,
              "verified_at"        => Time.current.iso8601,
            },
            metadata:        { "used_recovery_code" => result.used_recovery_code },
            correlation_id:  SecureRandom.uuid,
          )
        end

        result
      end

      private

      # Atomic: only one of N concurrent requests with the same code
      # can succeed. The conditional UPDATE on totp_last_used_at uses
      # the same compare-and-set pattern as the correlation-rule
      # cooldown (ADR-004) — a row lock plus the WHERE predicate on
      # the previous timestamp ensures that even if two requests
      # both read the same in-memory User and both pass ROTP's
      # verify(), only the first request to land its UPDATE writes
      # the new tip; the second request's WHERE clause sees the
      # updated DB value and the update_all returns 0 rows.
      def verify_totp(user, code)
        return Result.failure("Invalid TOTP code") if user.totp_secret.blank?

        totp = ROTP::TOTP.new(user.totp_secret, issuer: ISSUER)
        last_used = user.totp_last_used_at&.to_i
        verified_at = totp.verify(
          code.to_s.strip,
          drift_behind: 30,
          drift_ahead:  30,
          after:        last_used,
        )

        return Result.failure("Invalid TOTP code") unless verified_at

        new_last_used = Time.at(verified_at).utc
        rows = User.where(id: user.id)
                   .where("totp_last_used_at IS NULL OR totp_last_used_at < ?", new_last_used)
                   .update_all(totp_last_used_at: new_last_used)
        # rows = 0 means a concurrent request already claimed this
        # step (or a later one). Treat as a replay attempt.
        return Result.failure("Invalid TOTP code") if rows.zero?

        Result.success
      end

      # Atomic: a single-use recovery code can be redeemed at most
      # once. We walk active codes in memory to find the BCrypt
      # match (per-row salt prevents a SQL WHERE on the plaintext),
      # then claim the matched row with a conditional UPDATE that
      # only succeeds if used_at is still NULL. Two concurrent
      # requests with the same code race for the row lock; the
      # second request's WHERE used_at IS NULL fails after the
      # first commits, so update_all returns 0 rows.
      def verify_recovery_code(user, code)
        normalized = code.to_s.strip.downcase
        return Result.failure("Invalid recovery code") if normalized.blank?

        # Per-row salt means we have to walk active codes; can't
        # WHERE-match in SQL. Bounded by RECOVERY_CODE_COUNT (10).
        match = user.mfa_recovery_codes.active.find { |rc| rc.matches?(normalized) }
        return Result.failure("Invalid recovery code") unless match

        rows = MfaRecoveryCode.where(id: match.id, used_at: nil)
                              .update_all(used_at: Time.current)
        # rows = 0 means a concurrent request already redeemed this
        # exact code. Reject — single-use guarantee preserved.
        return Result.failure("Invalid recovery code") if rows.zero?

        Result.success(used_recovery_code: true)
      end
    end
  end
end
