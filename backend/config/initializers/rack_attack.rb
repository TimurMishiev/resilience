class Rack::Attack
  # Use an in-memory store for rate-limiting counters so throttle checks
  # never hit the database. Safe on a single-machine deploy; for multi-machine,
  # switch to a shared Redis or Memcached store.
  Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new

  # Local-perf bypass — enabled ONLY when both:
  #   1. Rails.env is "development" (production can never bypass,
  #      even if the env var is somehow set in deploy config)
  #   2. RACK_ATTACK_BYPASS=1 is in the environment
  #
  # Used by backend/perf/load-test/run.sh (Tranche 5A artifact).
  # Without this, the load-test driver's read scenarios firing
  # 500 requests in seconds blow through the global
  # api/ip/minute = 300 budget and the artifact ends up
  # measuring Rack::Attack's 429 short-circuit speed, not
  # endpoint thread/DB saturation. Production load distributes
  # across many IPs (each with its own per-IP budget) so the
  # single-source-IP throttle is not the right ceiling for
  # capacity planning.
  if Rails.env.development? && ENV["RACK_ATTACK_BYPASS"] == "1"
    # Bypass the broad api/ip/* throttles but KEEP login throttles
    # intact — the load-test artifact's Scenarios 1 and 2 deliberately
    # demonstrate the login throttle and would lose their meaning if
    # bypassed. Only /api/* requests other than /api/auth/login are
    # safelisted.
    Rack::Attack.safelist("local-perf-test-bypass") do |req|
      req.path.start_with?("/api") && req.path != "/api/auth/login"
    end
    Rails.logger.warn(
      "[Rack::Attack] LOCAL PERF BYPASS ENABLED — non-login /api throttles disabled (RACK_ATTACK_BYPASS=1)"
    )
  end

  # Per-minute caps raised from 30 → 120 (QA P3, 2026-04-29) to give
  # multi-tab demo sessions and brief reconnect storms enough headroom
  # before the throttle kicks in. The 5s SSE retry-floor (3e81336)
  # already prevents single-client churn from tripping these; this bump
  # protects against legitimate bursty navigation across multiple tabs
  # and against multi-user shared-NAT scenarios. The hourly caps are
  # unchanged — they remain the binding constraint for sustained usage.
  #
  # Env-tunable (post-push self-review follow-up, 2026-04-29) so production
  # can be re-tuned without a redeploy via flyctl secrets set.
  SSE_TOKEN_REQUESTS_PER_MINUTE = ENV.fetch("SSE_TOKEN_REQUESTS_PER_MINUTE", 120).to_i
  SSE_TOKEN_REQUESTS_PER_HOUR   = ENV.fetch("SSE_TOKEN_REQUESTS_PER_HOUR",   300).to_i
  SSE_STREAM_OPENS_PER_MINUTE   = ENV.fetch("SSE_STREAM_OPENS_PER_MINUTE",   120).to_i
  SSE_STREAM_OPENS_PER_HOUR     = ENV.fetch("SSE_STREAM_OPENS_PER_HOUR",     300).to_i

  # Repeat-offender blocklist parameters. Reduced bantime from 3600s → 60s
  # at f3d3e7b (QA P3, 2026-04-29). Extracted as named constants and made
  # env-tunable in this follow-up so a future scanner-abuse incident can
  # be hardened in production without a redeploy.
  REPEAT_OFFENDER_MAX_RETRY        = ENV.fetch("REPEAT_OFFENDER_MAX_RETRY",        10).to_i
  REPEAT_OFFENDER_FIND_TIME_SECS   = ENV.fetch("REPEAT_OFFENDER_FIND_TIME_SECS",   600).to_i
  REPEAT_OFFENDER_BAN_TIME_SECS    = ENV.fetch("REPEAT_OFFENDER_BAN_TIME_SECS",    60).to_i

  ### Throttles ###

  # Login endpoint — prevent brute-force credential stuffing.
  # Per-IP: 5 attempts per minute, 20 per hour (generic bot floor).
  LOGIN_IP_REQUESTS_PER_MINUTE = 5
  LOGIN_IP_REQUESTS_PER_HOUR   = 20

  throttle("login/ip/minute", limit: LOGIN_IP_REQUESTS_PER_MINUTE, period: 60) do |req|
    req.ip if req.path == "/api/auth/login" && req.post?
  end

  throttle("login/ip/hour", limit: LOGIN_IP_REQUESTS_PER_HOUR, period: 3600) do |req|
    req.ip if req.path == "/api/auth/login" && req.post?
  end

  # Per-email throttle — defends against distributed credential stuffing
  # where an attacker rotates source IPs across a botnet to stay under the
  # per-IP limit while targeting one account. Without this, a single
  # account can be attacked from 100 IPs × 5 attempts/min = 500 guesses/min
  # undetected.
  #
  # Intentionally tighter than per-IP (3/min vs 5, 10/hr vs 20) so one
  # targeted account cannot be probed more than 10 times per hour from any
  # combination of IPs. Legitimate users retrying a typoed password retry
  # well under these limits.
  LOGIN_EMAIL_REQUESTS_PER_MINUTE = 3
  LOGIN_EMAIL_REQUESTS_PER_HOUR   = 10

  throttle("login/email/minute", limit: LOGIN_EMAIL_REQUESTS_PER_MINUTE, period: 60) do |req|
    login_email_key(req)
  end

  throttle("login/email/hour", limit: LOGIN_EMAIL_REQUESTS_PER_HOUR, period: 3600) do |req|
    login_email_key(req)
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

  # Block IPs that have triggered REPEAT_OFFENDER_MAX_RETRY (default 10)
  # throttle violations within REPEAT_OFFENDER_FIND_TIME_SECS (default 600).
  # This catches automated scanners that keep hitting rate limits.
  #
  # Bantime reduced from 3600s → 60s (QA P3, 2026-04-29). The 1-hour ban
  # was a real demo-grade hazard: a reviewer who accidentally tripped 10
  # throttles during exploratory navigation would be locked out of the
  # entire app (including /login) for an hour. 60s self-heals before
  # anyone notices. Real scanners producing sustained abuse will still
  # be throttled continuously by the per-minute caps; the blocklist's
  # only job is to short-circuit the 429 response loop, and 60s is more
  # than enough to do that without bricking a legitimate session.
  blocklist("block-repeat-offenders") do |req|
    Rack::Attack::Allow2Ban.filter(
      req.ip,
      maxretry: REPEAT_OFFENDER_MAX_RETRY,
      findtime: REPEAT_OFFENDER_FIND_TIME_SECS,
      bantime:  REPEAT_OFFENDER_BAN_TIME_SECS,
    ) do
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

    # Extracts the login email from a POST /api/auth/login body for
    # per-email throttling. Handles the JSON-body shape the SPA sends
    # (`{"email": "...", "password": "..."}`) and Rails' wrap_parameters
    # variant (`{"session": {"email": "...", "password": "..."}}`).
    # Returns nil (throttle no-ops) for any other path, method, content
    # type, or parse failure.
    #
    # Body is rewound after reading so ActionDispatch can parse it
    # downstream — without this the login controller would see an empty
    # body and reject every request.
    def login_email_key(req)
      return nil unless req.post? && req.path == "/api/auth/login"
      return nil unless req.content_type.to_s.include?("application/json")
      return nil unless req.body.respond_to?(:read)

      req.body.rewind if req.body.respond_to?(:rewind)
      raw = req.body.read
      req.body.rewind if req.body.respond_to?(:rewind)
      return nil if raw.blank?

      parsed = JSON.parse(raw)
      email = parsed["email"] || parsed.dig("session", "email")
      return nil unless email.is_a?(String)

      email.downcase.strip.presence
    rescue StandardError
      nil
    end
  end
end
