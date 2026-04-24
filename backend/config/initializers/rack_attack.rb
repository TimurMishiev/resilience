class Rack::Attack
  # Use an in-memory store for rate-limiting counters so throttle checks
  # never hit the database. Safe on a single-machine deploy; for multi-machine,
  # switch to a shared Redis or Memcached store.
  Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new

  SSE_TOKEN_REQUESTS_PER_MINUTE = 30
  SSE_TOKEN_REQUESTS_PER_HOUR = 300
  SSE_STREAM_OPENS_PER_MINUTE = 30
  SSE_STREAM_OPENS_PER_HOUR = 300

  ### Throttles ###

  # Login endpoint — prevent brute-force credential stuffing.
  # 5 attempts per IP per minute; 20 per IP per hour.
  throttle("login/ip/minute", limit: 5, period: 60) do |req|
    req.ip if req.path == "/api/auth/login" && req.post?
  end

  throttle("login/ip/hour", limit: 20, period: 3600) do |req|
    req.ip if req.path == "/api/auth/login" && req.post?
  end

  # AI endpoints are expensive (Anthropic API calls) — limit tightly.
  # 10 requests per IP per minute; 100 per IP per hour.
  AI_IP_REQUESTS_PER_MINUTE = 10
  AI_IP_REQUESTS_PER_HOUR   = 100

  throttle("ai/ip/minute", limit: AI_IP_REQUESTS_PER_MINUTE, period: 60) do |req|
    req.ip if req.path.start_with?("/api/ai")
  end

  throttle("ai/ip/hour", limit: AI_IP_REQUESTS_PER_HOUR, period: 3600) do |req|
    req.ip if req.path.start_with?("/api/ai")
  end

  # Per-user AI throttles. Without these, multiple commanders on a shared
  # corporate NAT compete for one IP bucket — a single heavy user can burn
  # the whole team's quota. Keyed on the JWT subject extracted from the
  # request. Unauthenticated requests fall back to the IP throttles above;
  # malformed tokens simply skip per-user throttling (IP throttle still
  # applies).
  #
  # Per-user limits are intentionally tighter than per-IP so one user on a
  # shared IP cannot monopolise the bucket: 5/min vs 10/min at IP, 60/hr vs
  # 100/hr at IP. Two users sharing an IP can still each run at their full
  # 5/min limit (10/min combined = IP ceiling).
  AI_USER_REQUESTS_PER_MINUTE = 5
  AI_USER_REQUESTS_PER_HOUR   = 60

  throttle("ai/user/minute", limit: AI_USER_REQUESTS_PER_MINUTE, period: 60) do |req|
    ai_user_key(req) if req.path.start_with?("/api/ai")
  end

  throttle("ai/user/hour", limit: AI_USER_REQUESTS_PER_HOUR, period: 3600) do |req|
    ai_user_key(req) if req.path.start_with?("/api/ai")
  end

  # SSE token minting and stream opens are inexpensive individually but can
  # overwhelm Puma threads if a client reconnects in a tight loop.
  throttle("sse-token/ip/minute", limit: SSE_TOKEN_REQUESTS_PER_MINUTE, period: 60) do |req|
    req.ip if req.path == "/api/sse_token" && req.post?
  end

  throttle("sse-token/ip/hour", limit: SSE_TOKEN_REQUESTS_PER_HOUR, period: 3600) do |req|
    req.ip if req.path == "/api/sse_token" && req.post?
  end

  throttle("sse-stream-open/ip/minute", limit: SSE_STREAM_OPENS_PER_MINUTE, period: 60) do |req|
    req.ip if sse_stream_request?(req)
  end

  throttle("sse-stream-open/ip/hour", limit: SSE_STREAM_OPENS_PER_HOUR, period: 3600) do |req|
    req.ip if sse_stream_request?(req)
  end

  # General API — 300 requests per IP per minute (generous for a dashboard).
  throttle("api/ip/minute", limit: 300, period: 60) do |req|
    req.ip if req.path.start_with?("/api")
  end

  ### Blocklist ###

  # Block IPs that have triggered 10+ throttle violations in the last 10 minutes.
  # This catches automated scanners that keep hitting rate limits.
  blocklist("block-repeat-offenders") do |req|
    Rack::Attack::Allow2Ban.filter(req.ip, maxretry: 10, findtime: 600, bantime: 3600) do
      req.env["rack.attack.match_type"] == :throttle
    end
  end

  ### Response ###

  # Return 429 with a JSON body and Retry-After header.
  self.throttled_responder = lambda do |req|
    match_data = req.env["rack.attack.match_data"]
    now        = match_data[:epoch_time]
    retry_after = match_data[:period] - (now % match_data[:period])

    [
      429,
      {
        "Content-Type"  => "application/json",
        "Retry-After"   => retry_after.to_s,
      },
      [{ errors: ["Rate limit exceeded. Retry after #{retry_after}s."] }.to_json]
    ]
  end

  class << self
    # Keep this list in sync with the SSE stream endpoints defined in config/routes.rb.
    # Any new long-lived SSE endpoint must be added here to receive reconnect-storm throttling.
    def sse_stream_request?(req)
      req.get? && [
        "/api/events",
        "/api/signals/stream",
        "/api/telemetry/stream",
      ].include?(req.path)
    end

    # Extracts the authenticated user id from the request for per-user
    # throttling. Mirrors JwtAuthenticatable#extract_token's priority
    # (Authorization: Bearer header → _resilience_session cookie). Returns
    # nil on any decode failure; per-user throttle simply no-ops and the
    # per-IP throttle still applies.
    #
    # decode_payload only performs a JWT signature check — no DB call, no
    # revocation check — so this is cheap to evaluate per request.
    def ai_user_key(req)
      token = req.get_header("HTTP_AUTHORIZATION").to_s.delete_prefix("Bearer ").strip
      token = Rack::Request.new(req.env).cookies["_resilience_session"].to_s.strip if token.blank?
      return nil if token.blank?

      JwtAuthenticatable.decode_payload(token)[:sub]
    rescue StandardError
      nil
    end
  end
end
