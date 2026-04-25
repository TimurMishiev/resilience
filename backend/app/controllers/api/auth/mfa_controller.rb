module Api
  module Auth
    # MFA TOTP enrollment + management endpoints (Tranche 3B,
    # ADR-009 item 4 partial-CLOSED).
    #
    # Flow:
    #   POST /api/auth/mfa             — begin enrollment (returns
    #                                    provisioning URI + plaintext
    #                                    recovery codes; secret is
    #                                    persisted but MFA NOT
    #                                    enforced yet)
    #   POST /api/auth/mfa/confirm     — confirm enrollment by
    #                                    submitting a valid TOTP
    #                                    code; on success, MFA is
    #                                    enforced on subsequent
    #                                    logins
    #   DELETE /api/auth/mfa           — disable MFA (caller must
    #                                    re-prove identity by
    #                                    submitting a current TOTP
    #                                    code OR a recovery code)
    #
    # All endpoints require an authenticated session for the user
    # being modified — there is no "admin enrolls another user"
    # path in this slice. (Forced enrollment by role is a separate
    # follow-up tranche.)
    class MfaController < BaseController
      def create
        authorize :mfa, :enroll?

        # Re-enrollment for an already-enabled account is a credential
        # rotation that requires current-factor proof. Without this
        # gate, a hijacked authenticated session could call this
        # endpoint to wipe the existing TOTP secret + recovery codes
        # (begin_enrollment clears totp_enabled_at, rotates the
        # secret, deletes recovery codes) and effectively downgrade
        # the account to password-only until either the attacker
        # confirms with their own authenticator or the legitimate
        # user notices. Mirrors the destroy-flow re-proof contract.
        # First-time enrollment (totp_enabled? == false) is allowed
        # without a code because there is nothing to re-prove yet —
        # the password the caller already used to obtain the session
        # is sufficient.
        if current_user.totp_enabled?
          proof = Mfa::VerificationService.verify(
            user:          current_user,
            totp_code:     params[:totp_code],
            recovery_code: params[:recovery_code],
            actor:         current_user,
          )
          unless proof.ok?
            render json: { errors: [ proof.error ] }, status: :unauthorized
            return
          end
        end

        result = Mfa::EnrollmentService.begin_enrollment(current_user)

        render json: {
          provisioning_uri: result.provisioning_uri,
          secret:           result.secret,
          recovery_codes:   result.recovery_codes,
          # Echo confirmation status so a client polling this
          # endpoint can tell whether enrollment was already
          # confirmed by a prior session.
          confirmed:        current_user.totp_enabled?,
        }, status: :created
      end

      def confirm
        authorize :mfa, :confirm?
        ok = Mfa::EnrollmentService.confirm_enrollment(
          current_user,
          params[:totp_code],
          actor: current_user,
        )

        if ok
          render json: { confirmed: true, totp_enabled_at: current_user.totp_enabled_at }, status: :ok
        else
          render json: { errors: ["Invalid TOTP code"] }, status: :unprocessable_content
        end
      end

      def destroy
        authorize :mfa, :disable?

        unless current_user.totp_enabled?
          render json: { errors: ["MFA is not enabled"] }, status: :unprocessable_content
          return
        end

        # Re-prove identity before destroying the second factor —
        # otherwise an attacker who hijacks the session cookie can
        # silently downgrade the account to password-only.
        proof = Mfa::VerificationService.verify(
          user:          current_user,
          totp_code:     params[:totp_code],
          recovery_code: params[:recovery_code],
          actor:         current_user,
        )
        unless proof.ok?
          render json: { errors: [ proof.error ] }, status: :unauthorized
          return
        end

        Mfa::EnrollmentService.disable!(current_user, actor: current_user)
        head :no_content
      end
    end
  end
end
