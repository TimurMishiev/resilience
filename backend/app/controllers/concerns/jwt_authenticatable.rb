module JwtAuthenticatable
  extend ActiveSupport::Concern

  class AuthenticationError < StandardError; end

  SECRET    = Rails.application.secret_key_base
  ALGORITHM = "HS256"
  TTL       = 24.hours

  module_function

  def encode(payload)
    payload = payload.merge(exp: TTL.from_now.to_i, iat: Time.current.to_i)
    JWT.encode(payload, SECRET, ALGORITHM)
  end

  def decode(token)
    JWT.decode(token, SECRET, true, algorithm: ALGORITHM).first.with_indifferent_access
  rescue JWT::ExpiredSignature
    raise JwtAuthenticatable::AuthenticationError, "Token expired"
  rescue JWT::DecodeError
    raise JwtAuthenticatable::AuthenticationError, "Invalid token"
  end

  included do
    rescue_from JwtAuthenticatable::AuthenticationError do |e|
      render json: { errors: [e.message] }, status: :unauthorized
    end

    before_action :authenticate_request!

    private

    def authenticate_request!
      token = request.headers["Authorization"]&.delete_prefix("Bearer ")&.strip
      # SSE clients cannot send custom headers — fall back to query param
      token = params[:token]&.strip if token.blank?
      raise JwtAuthenticatable::AuthenticationError, "Missing token" if token.blank?

      payload = JwtAuthenticatable.decode(token)
      @current_user = User.find(payload[:sub])
    rescue ActiveRecord::RecordNotFound
      raise JwtAuthenticatable::AuthenticationError, "User not found"
    end

    def current_user
      @current_user
    end

    def actor
      current_user.email
    end
  end
end
