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
  throttle("ai/ip/minute", limit: 10, period: 60) do |req|
    req.ip if req.path.start_with?("/api/ai")
  end

  throttle("ai/ip/hour", limit: 100, period: 3600) do |req|
    req.ip if req.path.start_with?("/api/ai")
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
  end
end
