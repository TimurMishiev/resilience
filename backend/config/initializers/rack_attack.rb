class Rack::Attack
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

  # General API — 300 requests per IP per minute (generous for a dashboard).
  throttle("api/ip/minute", limit: 300, period: 60) do |req|
    req.ip if req.path.start_with?("/api")
  end

  ### Blocklist ###

  # Block IPs that have triggered 10+ throttle violations in the last 10 minutes.
  # This catches automated scanners that keep hitting rate limits.
  blocklist("block-repeat-offenders") do |req|
    Rack::Attack::Allow2Ban.filter(req.ip, maxretry: 10, findtime: 600, bantime: 3600) do
      req.env["rack.attack.matched"] == "throttle"
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
end
