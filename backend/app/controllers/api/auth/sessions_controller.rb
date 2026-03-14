module Api
  module Auth
    class SessionsController < ApplicationController
      def create
        user = User.find_by(email: params.dig(:session, :email)&.downcase)

        if user&.authenticate(params.dig(:session, :password))
          token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
          render json: {
            token: token,
            user: { id: user.id, email: user.email, role: user.role }
          }, status: :created
        else
          render json: { errors: ["Invalid email or password"] }, status: :unauthorized
        end
      end
    end
  end
end
