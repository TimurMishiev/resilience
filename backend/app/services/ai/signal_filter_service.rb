module Ai
  # Translates a natural language operator query into structured signal filter params.
  # Mirrors the structure of Ai::FilterService but targets the signals endpoint.
  # Uses Claude tool_use with enum-constrained schema for the same prompt-injection
  # resistance and structural validity guarantees.
  class SignalFilterService < ApplicationService
    include ScopedRelations

    ALLOWED_SIGNAL_TYPES = %w[
      aircraft_position vessel_position seismic_event gps_jamming
      wildfire ais_gap conflict_event disaster_alert manual
    ].freeze

    ALLOWED_SOURCES = %w[
      opensky ais usgs_seismic gpsjam firms_wildfire acled gdacs manual derived
    ].freeze

    TOOL_NAME = "apply_signal_filters"
    BREAKER_SERVICE           = "signal_filter"
    DEFAULT_MODEL             = "claude-haiku-4-5-20251001"
    # Timeout/retries centralized in Ai::AnthropicClient (audit P3).

    def initialize(query:, user:)
      @query = query.to_s.strip
      @user = user
    end

    def call
      return ServiceResult.failure(errors: ["Query cannot be blank"]) if @query.blank?
      return ServiceResult.failure(errors: ["AI temporarily unavailable. Please retry shortly."]) if Ai::CircuitBreaker.open?(service: BREAKER_SERVICE)

      sites = site_catalog
      # Audit P3 (2026-04-29): redundant local client construction
      # removed; messages_create uses Ai::AnthropicClient.client defaults.
      response = Ai::AnthropicClient.messages_create(
        service:     "signal_filter",
        model:       filter_model,
        max_tokens:  256,
        system:      SYSTEM_PROMPT,
        tools:       [ build_tool(sites) ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages:    [ { role: "user", content: @query } ]
      )

      tool_block = response.content.find { |b| b.type.to_s == "tool_use" && b.name == TOOL_NAME }
      return ServiceResult.failure(errors: ["AI did not return a filter tool call"]) unless tool_block

      filters = validate_filters((tool_block.input || {}).with_indifferent_access, sites)
      Ai::CircuitBreaker.record_success(service: BREAKER_SERVICE)
      ServiceResult.success({ original_query: @query, filters: filters })

    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue Anthropic::Errors::APITimeoutError => e
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "Signal filter query timed out", failure: "timeout")
      ServiceResult.failure(errors: ["Signal filter query timed out"])
    rescue Anthropic::Errors::Error => e
      # Audit P3 (2026-04-29): see SummaryService for rationale.
      # Classified via Ai::ErrorClassifier so the user-facing message
      # distinguishes misconfigured / unavailable / transient causes.
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "AI service error: #{e.message}", failure: Ai::ErrorClassifier.failure_tag(e))
      ServiceResult.failure(errors: [Ai::ErrorClassifier.user_message(e)])
    end

    private

    SYSTEM_PROMPT = <<~PROMPT.strip
      You are a filter translator for a mission operations console.
      Convert the operator's natural language query into signal filter parameters
      by calling the #{TOOL_NAME} tool.
      If a filter field is not mentioned or unclear, omit it or set it to null.
    PROMPT

    # Audit P3 follow-up (2026-04-29, Codex /gate at f149dbf): see
    # FilterService#build_tool for rationale. Site names sanitized
    # before tool-description interpolation.
    def build_tool(sites)
      site_enum         = sites.map { |s| s[:id] }
      site_descriptions = sites.map { |s| "#{Ai::PromptSafety.sanitize_for_prompt(s[:name])} → #{s[:id]}" }.join(", ")

      {
        name:        TOOL_NAME,
        description: "Apply structured filters to the signals list based on the operator's query.",
        input_schema: {
          type:       "object",
          properties: {
            signal_type: {
              type:        ["string", "null"],
              enum:        ALLOWED_SIGNAL_TYPES + [nil],
              description: "Type of signal to filter by"
            },
            source: {
              type:        ["string", "null"],
              enum:        ALLOWED_SOURCES + [nil],
              description: "Signal source system"
            },
            site_id: {
              type:        ["string", "null"],
              enum:        site_enum + [nil],
              description: "UUID of the target site (proximity filter). Available sites: #{site_descriptions}"
            },
            from: {
              type:        ["string", "null"],
              description: "ISO 8601 datetime — only return signals after this time"
            },
            to: {
              type:        ["string", "null"],
              description: "ISO 8601 datetime — only return signals before this time"
            }
          },
          required: []
        }
      }
    end

    def validate_filters(input, sites)
      valid_site_ids = sites.map { |s| s[:id] }

      signal_type = ALLOWED_SIGNAL_TYPES.include?(input["signal_type"]) ? input["signal_type"] : nil
      source      = ALLOWED_SOURCES.include?(input["source"])           ? input["source"]      : nil
      site_id     = valid_site_ids.include?(input["site_id"])           ? input["site_id"]     : nil
      from        = safe_parse_datetime(input["from"])
      to          = safe_parse_datetime(input["to"])

      { signal_type:, source:, site_id:, from:, to: }
    end

    def safe_parse_datetime(value)
      return nil if value.blank?
      parsed = Time.zone.parse(value.to_s)
      parsed&.iso8601
    rescue ArgumentError, TypeError
      nil
    end

    def site_catalog
      build_site_catalog
    end

    def build_site_catalog
      scoped_sites.order(:name).pluck(:id, :name).map do |id, name|
        { id: id, name: name }
      end
    end

    def filter_model
      ENV.fetch("SIGNAL_FILTER_MODEL", DEFAULT_MODEL)
    end

    def report_exception(exception, message:, failure:)
      Rails.logger.error("[SignalFilterService] #{message}: #{exception.class} - #{exception.message}")
      Observability.capture_exception(
        exception,
        tags: { service: "signal_filter", failure: failure },
        extra: { query: @query },
        throttle_key: "signal_filter:#{failure}:#{exception.class.name}",
      )
    end
  end
end
