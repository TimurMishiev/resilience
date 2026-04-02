module Api
  module Auth
    class SessionsController < ApplicationController
      def create
        user = User.find_by(email: params.dig(:session, :email)&.downcase)

        if user&.authenticate(params.dig(:session, :password))
          token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)

          # Set an httpOnly cookie so the token is never accessible to JavaScript.
          # The Authorization: Bearer <token> path (used by API clients and tests)
          # is still supported via jwt_authenticatable#extract_token.
          response.set_cookie(
            :_resilience_session,
            value:     token,
            httponly:  true,
            same_site: :lax,
            secure:    Rails.env.production? || request.ssl?,
            path:      "/",
            expires:   JwtAuthenticatable::TTL.from_now
          )

          render json: { user: { id: user.id, email: user.email, role: user.role } },
                 status: :created
        else
          render json: { errors: ["Invalid email or password"] }, status: :unauthorized
        end
      end

      # DELETE /api/auth/logout — clears the session cookie
      # Params:
      #   all_sessions: true — also bumps tokens_valid_after on the user record,
      #                        invalidating every outstanding token for this account.
      def destroy
        token = request.cookies["_resilience_session"]&.strip
        token ||= request.headers["Authorization"]&.delete_prefix("Bearer ")&.strip
        JwtAuthenticatable.revoke!(token) if token.present?

        if ActiveModel::Type::Boolean.new.cast(params[:all_sessions])
          user = current_user_from_token(token)
          user&.update_columns(tokens_valid_after: Time.current)
        end

        response.delete_cookie(:_resilience_session, path: "/")
        head :no_content
      end

      private

      def current_user_from_token(token)
        return nil if token.blank?

        payload = JwtAuthenticatable.decode_payload(token)
        User.find_by(id: payload[:sub])
      rescue JwtAuthenticatable::AuthenticationError
        nil
      end
    end
  end
end
