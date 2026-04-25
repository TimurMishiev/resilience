require "rails_helper"

RSpec.describe "Api::Auth::Mfa", type: :request do
  let(:user) { create(:user, :commander) }

  describe "POST /api/auth/mfa (enroll)" do
    it "returns provisioning_uri + secret + recovery_codes on first enrollment" do
      post "/api/auth/mfa", headers: auth_headers(user)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)

      expect(body["provisioning_uri"]).to start_with("otpauth://totp/")
      expect(body["secret"]).to match(/\A[A-Z2-7]+\z/)
      expect(body["recovery_codes"].size).to eq(10)
      expect(body["confirmed"]).to be(false)
    end

    it "rotates the secret + recovery codes when called again before confirmation (draft state, no re-proof needed)" do
      # Draft state: secret allocated but totp_enabled_at still nil.
      # Re-enrolling here is allowed without re-proof because there
      # is no live factor to protect — the user is mid-flow.
      post "/api/auth/mfa", headers: auth_headers(user)
      first = JSON.parse(response.body)

      post "/api/auth/mfa", headers: auth_headers(user)
      second = JSON.parse(response.body)

      expect(response).to have_http_status(:created)
      expect(second["secret"]).not_to eq(first["secret"])
      expect((second["recovery_codes"] & first["recovery_codes"])).to be_empty
    end

    it "is unauthorized without a session" do
      post "/api/auth/mfa"
      expect(response).to have_http_status(:unauthorized)
    end

    # ── P1 fix: re-enrollment for an already-enabled account requires current-factor re-proof ──
    context "when MFA is already enabled (re-enrollment guard)" do
      let(:enrolled) do
        result = Mfa::EnrollmentService.begin_enrollment(user)
        Mfa::EnrollmentService.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now)
        user.reload
        result
      end

      it "rejects re-enrollment when no proof is supplied (defends session-hijack downgrade)" do
        enrolled
        original_ciphertext = user.totp_secret_ciphertext
        original_codes_count = user.mfa_recovery_codes.count

        post "/api/auth/mfa", headers: auth_headers(user)

        expect(response).to have_http_status(:unauthorized)
        expect(JSON.parse(response.body)["errors"]).to include(/MFA code required/)

        # Critical: the existing factor must NOT have been rotated
        # or wiped by the rejected request.
        user.reload
        expect(user.totp_enabled?).to be(true)
        expect(user.totp_secret_ciphertext).to eq(original_ciphertext)
        expect(user.mfa_recovery_codes.count).to eq(original_codes_count)
      end

      it "rejects re-enrollment when the supplied TOTP code is wrong" do
        enrolled
        original_ciphertext = user.totp_secret_ciphertext

        post "/api/auth/mfa",
             params: { totp_code: "000000" },
             headers: auth_headers(user),
             as: :json

        expect(response).to have_http_status(:unauthorized)
        user.reload
        expect(user.totp_enabled?).to be(true)
        expect(user.totp_secret_ciphertext).to eq(original_ciphertext)
      end

      it "permits re-enrollment when a valid TOTP code is supplied (rotates the factor)" do
        result = enrolled
        travel 31.seconds do
          live_code = ROTP::TOTP.new(result.secret).now

          post "/api/auth/mfa",
               params: { totp_code: live_code },
               headers: auth_headers(user),
               as: :json

          expect(response).to have_http_status(:created)
          body = JSON.parse(response.body)
          expect(body["secret"]).not_to eq(result.secret)
          # Re-enrollment puts the user back into draft state until confirm.
          expect(body["confirmed"]).to be(false)
          user.reload
          expect(user.totp_enabled?).to be(false)
        end
      end

      it "permits re-enrollment when a valid recovery code is supplied (and consumes it)" do
        result = enrolled
        recovery_code = result.recovery_codes.first

        post "/api/auth/mfa",
             params: { recovery_code: recovery_code },
             headers: auth_headers(user),
             as: :json

        expect(response).to have_http_status(:created)
        # Recovery code is single-use so begin_enrollment also wiped
        # all codes — the proof was consumed in spirit and in fact.
        # Confirm the new draft state.
        user.reload
        expect(user.totp_enabled?).to be(false)
      end
    end
  end

  describe "POST /api/auth/mfa/confirm" do
    it "enables MFA when given a valid TOTP code" do
      post "/api/auth/mfa", headers: auth_headers(user)
      secret = JSON.parse(response.body)["secret"]

      post "/api/auth/mfa/confirm",
           params: { totp_code: ROTP::TOTP.new(secret).now },
           headers: auth_headers(user),
           as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["confirmed"]).to be(true)
      expect(user.reload.totp_enabled?).to be(true)
    end

    it "returns 422 with 'Invalid TOTP code' on a wrong code" do
      post "/api/auth/mfa", headers: auth_headers(user)

      post "/api/auth/mfa/confirm",
           params: { totp_code: "000000" },
           headers: auth_headers(user),
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([ "Invalid TOTP code" ])
    end
  end

  describe "DELETE /api/auth/mfa (disable)" do
    let(:enrolled_user) do
      result = Mfa::EnrollmentService.begin_enrollment(user)
      Mfa::EnrollmentService.confirm_enrollment(user, ROTP::TOTP.new(result.secret).now)
      [ user.reload, result ]
    end

    it "disables MFA when caller proves identity with a current TOTP code" do
      enrolled_user_inst, result = enrolled_user
      travel 31.seconds do
        delete "/api/auth/mfa",
               params: { totp_code: ROTP::TOTP.new(result.secret).now },
               headers: auth_headers(enrolled_user_inst),
               as: :json

        expect(response).to have_http_status(:no_content)
        expect(enrolled_user_inst.reload.totp_enabled?).to be(false)
        expect(enrolled_user_inst.mfa_recovery_codes).to be_empty
      end
    end

    it "disables MFA when caller proves identity with a recovery code" do
      enrolled_user_inst, result = enrolled_user

      delete "/api/auth/mfa",
             params: { recovery_code: result.recovery_codes.first },
             headers: auth_headers(enrolled_user_inst),
             as: :json

      expect(response).to have_http_status(:no_content)
      expect(enrolled_user_inst.reload.totp_enabled?).to be(false)
    end

    it "rejects disable when no code is supplied (defends against session-hijack downgrade)" do
      enrolled_user_inst, _ = enrolled_user

      delete "/api/auth/mfa", headers: auth_headers(enrolled_user_inst), as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(enrolled_user_inst.reload.totp_enabled?).to be(true)
    end

    it "returns 422 when MFA is not enabled" do
      delete "/api/auth/mfa", headers: auth_headers(user), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([ "MFA is not enabled" ])
    end
  end
end
