module Api
  # Issues a short-lived (60s) SSE-only token.
  # The client calls POST /api/sse_token with their regular 24h JWT,
  # receives a 60s token, then opens the EventSource URL with ?token=<sse_token>.
  # Even if the URL leaks into proxy/access logs, the token expires in 60 seconds.
  class SseTokensController < BaseController
    skip_after_action :verify_authorized

    def create
      token = JwtAuthenticatable.encode_sse(current_user.id)
      render json: { token: token, expires_in: JwtAuthenticatable::SSE_TTL.to_i }
    end
  end
end
