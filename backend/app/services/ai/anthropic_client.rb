module Ai
  # Thin wrapper around Anthropic::Client to consolidate construction and
  # capture per-call instrumentation (latency, tokens, estimated cost,
  # status) into Metrics::Recorder. AI service classes call through this
  # so a new call site cannot accidentally bypass timeout/retries or the
  # cost ledger.
  #
  # Pricing constants are USD per million tokens, sourced from
  # https://platform.claude.com/docs/en/about-claude/pricing
  # Verified 2026-04-26.
  module AnthropicClient
    PRICING = {
      "claude-haiku-4-5"  => { input_per_mtok: 1.0, output_per_mtok:  5.0 },
      "claude-sonnet-4-6" => { input_per_mtok: 3.0, output_per_mtok: 15.0 },
      "claude-opus-4-7"   => { input_per_mtok: 5.0, output_per_mtok: 25.0 },
    }.freeze

    DEFAULT_TIMEOUT_SECONDS = 30
    DEFAULT_MAX_RETRIES     = 2

    # Build an Anthropic::Client. Centralised so tests can stub
    # Anthropic::Client.new and so we never forget timeout/max_retries
    # on a new call site.
    def self.client(timeout: DEFAULT_TIMEOUT_SECONDS, max_retries: DEFAULT_MAX_RETRIES)
      ::Anthropic::Client.new(
        api_key:     ENV.fetch("ANTHROPIC_API_KEY"),
        timeout:     timeout,
        max_retries: max_retries,
      )
    end

    # Send a messages.create call and record per-call instrumentation.
    # On success records duration_ms + token usage + estimated cost with
    # status "success". On Anthropic::Errors::APITimeoutError records
    # duration_ms with status "timeout" and re-raises. On any other
    # Anthropic::Errors::Error records duration_ms with status "error"
    # and re-raises. The caller's existing rescue blocks see the
    # exception unchanged.
    def self.messages_create(service:, model:, client: nil, **kwargs)
      client ||= self.client
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)

      begin
        response = client.messages.create(model: model, **kwargs)
      rescue ::Anthropic::Errors::APITimeoutError
        record_call(service: service, model: model, response: nil, started: started, status: "timeout")
        raise
      rescue ::Anthropic::Errors::Error
        record_call(service: service, model: model, response: nil, started: started, status: "error")
        raise
      end

      record_call(service: service, model: model, response: response, started: started, status: "success")
      response
    end

    def self.record_call(service:, model:, response:, started:, status:)
      duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round(1)
      input_tokens, output_tokens = extract_tokens(response)

      ::Metrics::Recorder.record_ai_call(service: service, duration_ms: duration_ms)
      ::Metrics::Recorder.record_ai_usage(
        service:            service,
        model:              model,
        duration_ms:        duration_ms,
        input_tokens:       input_tokens,
        output_tokens:      output_tokens,
        total_tokens:       input_tokens + output_tokens,
        estimated_cost_usd: estimate_cost(model, input_tokens: input_tokens, output_tokens: output_tokens),
        status:             status,
      )
    end

    def self.extract_tokens(response)
      return [0, 0] if response.nil?
      return [0, 0] unless response.respond_to?(:usage)

      usage = response.usage
      return [0, 0] unless usage

      input  = usage.respond_to?(:input_tokens)  ? usage.input_tokens.to_i  : 0
      output = usage.respond_to?(:output_tokens) ? usage.output_tokens.to_i : 0
      [input, output]
    end

    # Returns 0.0 for unknown models so eval output shows the call but
    # never fabricates a cost. Add a PRICING entry the moment a new
    # model is adopted.
    def self.estimate_cost(model, input_tokens:, output_tokens:)
      pricing = PRICING[normalize_model(model)]
      return 0.0 unless pricing

      input_cost  = input_tokens.to_i  / 1_000_000.0 * pricing[:input_per_mtok]
      output_cost = output_tokens.to_i / 1_000_000.0 * pricing[:output_per_mtok]
      (input_cost + output_cost).round(6)
    end

    # Strip dated suffix (claude-haiku-4-5-20251001 → claude-haiku-4-5).
    # Anthropic publishes both aliased and dated model IDs; dated IDs
    # append "-YYYYMMDD" to the alias. Pricing matches the alias.
    def self.normalize_model(model)
      model.to_s.sub(/-\d{8}\z/, "")
    end
  end
end
