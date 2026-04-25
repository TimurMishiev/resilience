module Api
  module Auth
    class SessionsController < ApplicationController
      include JwtAuthenticatable
      include Pundit::Authorization
      after_action :verify_authorized

      rescue_from Pundit::NotAuthorizedError do |_e|
        render json: { errors: ["Not authorized"] }, status: :forbidden
      end

      skip_before_action :authenticate_request!, only: :create

      # POST /api/auth/login
      #
      # Body: { session: { email, password, totp_code?, recovery_code? } }
      #
      # MFA flow (Tranche 3B / ADR-009 item 4): when a user has
      # TOTP enabled, the login response from the password-only
      # call is 401 with `{ mfa_required: true }`. The client
      # reissues the login with `totp_code` (6-digit authenticator
      # code) or `recovery_code` (one of the user's 10 single-use
      # backup codes). We never issue a "challenge token" or
      # short-lived intermediate JWT — keeping the protocol
      # one-step-or-two avoids a third token shape on the wire.
      def create
        authorize :session, :create?
        return render(json: { errors: ["Login request from unauthorised origin"] }, status: :forbidden) unless browser_origin_permitted?

        user = User.find_by(email: params.dig(:session, :email)&.downcase)

        unless user&.authenticate(params.dig(:session, :password))
          render json: { errors: ["Invalid email or password"] }, status: :unauthorized
          return
        end

        if user.totp_enabled?
          totp_code     = params.dig(:session, :totp_code)
          recovery_code = params.dig(:session, :recovery_code)

          if totp_code.blank? && recovery_code.blank?
            render json: { errors: ["MFA code required"], mfa_required: true }, status: :unauthorized
            return
          end

          mfa_result = Mfa::VerificationService.verify(
            user:          user,
            totp_code:     totp_code,
            recovery_code: recovery_code,
            actor:         user,
          )
          unless mfa_result.ok?
            render json: { errors: [ mfa_result.error ], mfa_required: true }, status: :unauthorized
            return
          end
        end

        token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
        payload = JwtAuthenticatable.decode_payload(token)
        UserSession.issue!(user: user, token_payload: payload, request: request)

        response.set_cookie(
          :_resilience_session,
          value:     token,
          httponly:  true,
          same_site: :lax,
          secure:    Rails.configuration.assume_ssl || request.ssl?,
          path:      "/",
          expires:   JwtAuthenticatable::TTL.from_now
        )

        render json: { user: serialize_user(user) }, status: :created
      end

      # GET /api/auth/sessions
      # Admins may target another account via user_id or user_email.
      def index
        authorize :session, :index?
        target_user = target_user_for_session_management
        return unless target_user

        unless current_user.can_manage_sessions_for?(target_user)
          render json: { errors: ["Not authorized"] }, status: :forbidden
          return
        end

        sessions = UserSession.where(user_id: target_user.id).includes(:user, :revoked_by).recent_first.limit(100)

        render json: {
          data: sessions.map { |session| serialize_session(session) },
          meta: {
            user_id: target_user.id,
            user_email: target_user.email,
          },
        }
      end

      # DELETE /api/auth/logout
      # Params:
      #   all_sessions: true — revoke every active session for the authenticated user
      def destroy
        authorize :session, :destroy?
        token = extract_logout_token
        payload = token.present? ? JwtAuthenticatable.decode_payload(token) : nil

        current_session&.revoke!(actor: current_user, reason: "logout")
        JwtAuthenticatable.revoke!(token) if token.present?

        if ActiveModel::Type::Boolean.new.cast(params[:all_sessions])
          current_user.update_columns(tokens_valid_after: Time.current)
          UserSession.revoke_scope!(
            UserSession.active.where(user_id: current_user.id),
            actor: current_user,
            reason: "logout_all",
          )
        end

        response.delete_cookie(:_resilience_session, path: "/")
        head :no_content
      rescue JwtAuthenticatable::AuthenticationError
        response.delete_cookie(:_resilience_session, path: "/")
        head :no_content
      end

      # DELETE /api/auth/sessions/:id
      def revoke
        authorize :session, :revoke?
        session = session_scope.find(params[:id])
        session.revoke!(actor: current_user, reason: "manual_revoke")
        head :no_content
      end

      # DELETE /api/auth/sessions
      # Params:
      #   all=true               — required
      #   keep_current=true      — keep the current session active (self only)
      #   user_id / user_email   — admin-only target selector
      def revoke_all
        authorize :session, :revoke_all?
        unless ActiveModel::Type::Boolean.new.cast(params[:all])
          render json: { errors: ["all=true is required"] }, status: :bad_request
          return
        end

        target_user = target_user_for_session_management
        return unless target_user

        keep_current = target_user.id == current_user.id && ActiveModel::Type::Boolean.new.cast(params[:keep_current])
        keep_jti = keep_current ? current_token_payload&.[](:jti) : nil

        UserSession.revoke_scope!(
          UserSession.active.where(user_id: target_user.id),
          actor: current_user,
          reason: keep_current ? "manual_revoke_others" : "manual_revoke_all",
          keep_jti: keep_jti,
        )

        target_user.update_columns(tokens_valid_after: Time.current) unless keep_current

        head :no_content
      end

      private

      # Defence-in-depth against login-CSRF: a malicious cross-origin page
      # cannot make a victim's browser perform a login that would set our
      # session cookie. Multiple layers already mitigate this:
      #   - Rack::Cors restricts the allowed origins; cross-origin POSTs
      #     with Content-Type: application/json trigger a preflight that
      #     a non-allowlisted origin cannot pass.
      #   - The session cookie is SameSite=Lax, so browsers do not attach
      #     it to cross-site subresource requests in the first place.
      #
      # This controller-layer check duplicates the origin allowlist
      # *inside* the application so a misconfigured Rack::Cors setting
      # (e.g. accidental wildcard via env var) does not silently widen
      # the login surface. Server-to-server clients and test suites
      # typically omit Origin/Referer; they bypass this check, matching
      # the prior contract.
      def browser_origin_permitted?
        origin_header = request.headers["Origin"].presence || request.headers["Referer"].presence
        return true if origin_header.blank?

        origin_host = (URI.parse(origin_header).host rescue nil)
        return true if origin_host.blank?

        allowed_hosts = ENV.fetch("CORS_ORIGINS", "http://localhost:5173")
                           .split(",")
                           .map { |o| (URI.parse(o.strip).host rescue nil) }
                           .compact

        allowed_hosts.include?(origin_host)
      end

      def extract_logout_token
        request.cookies["_resilience_session"]&.strip ||
          request.headers["Authorization"]&.delete_prefix("Bearer ")&.strip
      end

      def target_user_for_session_management
        if params[:user_id].present? || params[:user_email].present?
          unless current_user.admin?
            render json: { errors: ["Admin role required"] }, status: :forbidden
            return nil
          end

          target = if params[:user_id].present?
            User.find_by(id: params[:user_id])
          else
            User.find_by(email: params[:user_email].to_s.downcase)
          end

          unless target
            render json: { errors: ["User not found"] }, status: :not_found
            return nil
          end

          return target
        end

        current_user
      end

      def session_scope
        target_user = target_user_for_session_management
        return UserSession.none unless target_user

        unless current_user.can_manage_sessions_for?(target_user)
          render json: { errors: ["Not authorized"] }, status: :forbidden
          return UserSession.none
        end

        UserSession.where(user_id: target_user.id)
      end

      def serialize_session(session)
        {
          id: session.id,
          user_id: session.user_id,
          user_email: session.user.email,
          current: current_token_payload&.[](:jti) == session.jti,
          ip_address: session.ip_address,
          user_agent: session.user_agent,
          last_seen_at: session.last_seen_at,
          created_at: session.created_at,
          expires_at: session.expires_at,
          revoked_at: session.revoked_at,
          revoke_reason: session.revoke_reason,
          revoked_by_email: session.revoked_by&.email,
        }
      end

      def serialize_user(user)
        {
          id: user.id,
          email: user.email,
          role: user.role,
          organization_id: user.organization_id,
          area_of_operation_id: user.area_of_operation_id,
        }
      end
    end
  end
end
