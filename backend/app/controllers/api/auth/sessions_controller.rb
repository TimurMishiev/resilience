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
            secure:    Rails.env.production?,
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
      def destroy
        response.delete_cookie(:_resilience_session, path: "/")
        head :no_content
      end
    end
  end
end
