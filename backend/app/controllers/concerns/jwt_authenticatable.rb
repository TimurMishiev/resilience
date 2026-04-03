module JwtAuthenticatable
  extend ActiveSupport::Concern

  class AuthenticationError < StandardError; end

  SECRET      = Rails.application.secret_key_base
  ALGORITHM   = "HS256"
  TTL         = 24.hours
  SSE_TTL     = 60.seconds   # short-lived token issued for SSE connections only

  module_function

  def encode(payload)
    payload = payload.merge(exp: TTL.from_now.to_i, iat: Time.current.to_i, jti: SecureRandom.uuid)
    JWT.encode(payload, SECRET, ALGORITHM)
  end

  # Issues a short-lived (60s) SSE-only token.
  # Tokens carry sse_only: true so regular API endpoints can reject them.
  def encode_sse(user_id)
    payload = { sub: user_id, sse_only: true, exp: SSE_TTL.from_now.to_i, iat: Time.current.to_i, jti: SecureRandom.uuid }
    JWT.encode(payload, SECRET, ALGORITHM)
  end

  def decode(token)
    payload = decode_payload(token)
    raise JwtAuthenticatable::AuthenticationError, "Token revoked" if revoked?(payload[:jti])

    # Global revocation: reject tokens issued before the user's tokens_valid_after timestamp.
    # This allows a single "log out all sessions" operation without enumerating JTIs.
    if (sub = payload[:sub].presence)
      valid_after = User.where(id: sub).pick(:tokens_valid_after)
      if valid_after && payload[:iat].present? && payload[:iat].to_i < valid_after.to_i
        raise JwtAuthenticatable::AuthenticationError, "Token revoked"
      end
    end

    payload
  end

  def revoke!(token)
    payload = decode_payload(token)
    revoke_payload!(payload)
  rescue JwtAuthenticatable::AuthenticationError
    nil
  end

  def decode_payload(token)
    JWT.decode(token, SECRET, true, algorithm: ALGORITHM).first.with_indifferent_access
  rescue JWT::ExpiredSignature
    raise JwtAuthenticatable::AuthenticationError, "Token expired"
  rescue JWT::DecodeError
    raise JwtAuthenticatable::AuthenticationError, "Invalid token"
  end

  def revoke_payload!(payload)
    jti = payload[:jti].presence
    exp = payload[:exp].present? ? Time.at(payload[:exp].to_i) : nil
    return if jti.blank? || exp.blank? || exp <= Time.current

    RevokedJwt.upsert(
      {
        jti: jti,
        expires_at: exp,
        created_at: Time.current,
        updated_at: Time.current,
      },
      unique_by: :index_revoked_jwts_on_jti
    )
  end

  def revoked?(jti)
    return false if jti.blank?

    RevokedJwt.active.exists?(jti: jti)
  end

  included do
    rescue_from JwtAuthenticatable::AuthenticationError do |e|
      render json: { errors: [e.message] }, status: :unauthorized
    end

    before_action :authenticate_request!

    private

    def authenticate_request!
      token = extract_token
      raise JwtAuthenticatable::AuthenticationError, "Missing token" if token.blank?

      payload = JwtAuthenticatable.decode(token)

      # SSE-only tokens must not be accepted by regular API endpoints.
      # Only EventsController explicitly permits them.
      if payload[:sse_only] && !sse_endpoint?
        raise JwtAuthenticatable::AuthenticationError, "SSE token cannot be used for API requests"
      end

      @current_token_payload = payload
      @current_user = User.find(payload[:sub])
      hydrate_current_session(payload)
    rescue ActiveRecord::RecordNotFound
      raise JwtAuthenticatable::AuthenticationError, "User not found"
    end

    def extract_token
      # Priority: Authorization header (API clients / tests) → httpOnly cookie
      # (browser-originated requests) → query param (SSE only).
      token = request.headers["Authorization"]&.delete_prefix("Bearer ")&.strip
      token = request.cookies["_resilience_session"]&.strip if token.blank? && !sse_endpoint?
      token = params[:token]&.strip                           if token.blank? && sse_endpoint?
      token
    end

    # Override in EventsController to mark it as an SSE endpoint.
    def sse_endpoint?
      false
    end

    def current_user
      @current_user
    end

    def current_token_payload
      @current_token_payload
    end

    def current_session
      @current_session
    end

    def actor
      current_user.email
    end

    def hydrate_current_session(payload)
      return unless defined?(UserSession) && UserSession.table_exists?
      return if payload[:jti].blank?

      @current_session = UserSession.active.find_by(jti: payload[:jti])
      @current_session&.touch_if_stale!
    rescue StandardError => e
      Rails.logger.warn("[JwtAuthenticatable] failed to hydrate current session jti=#{payload[:jti]} error=#{e.class}: #{e.message}")
    end
  end
end
