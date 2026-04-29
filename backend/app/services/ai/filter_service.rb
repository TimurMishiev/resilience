module Ai
  # Translates a natural language operator query into structured task filter params.
  #
  # Uses Claude tool_use instead of free-form JSON generation:
  # - Valid site_ids are embedded as an `enum` in the tool schema, so the model
  #   is structurally prevented from returning an invalid UUID regardless of what
  #   the user query or site names contain.
  # - workflow_status and priority are also enum-constrained at the schema level.
  # - No prompt injection risk from site names — names appear only in the
  #   description field, never as executable instructions.
  class FilterService < ApplicationService
    include ScopedRelations

    ALLOWED_WORKFLOW_STATUSES = %w[new triaged in_progress blocked resolved].freeze
    ALLOWED_PRIORITIES        = %w[low normal high critical].freeze
    TOOL_NAME                 = "apply_task_filters"
    BREAKER_SERVICE           = "task_filter"
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
      # See SummaryService for full rationale.
      response = Ai::AnthropicClient.messages_create(
        service:     "task_filter",
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
      report_exception(e, message: "Task filter query timed out", failure: "timeout")
      ServiceResult.failure(errors: ["Task filter query timed out"])
    rescue Anthropic::Errors::Error => e
      # Audit P3 (2026-04-29): see SummaryService for rationale.
      # Server-side log captures full diagnostic; client sees generic.
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "AI service error: #{e.message}", failure: "error")
      ServiceResult.failure(errors: ["AI service temporarily unavailable. Please retry shortly."])
    end

    private

    SYSTEM_PROMPT = <<~PROMPT.strip
      You are a filter translator for a mission operations console.
      Convert the operator's natural language query into task filter parameters
      by calling the #{TOOL_NAME} tool.
      If a filter field is not mentioned or unclear, omit it or set it to null.
    PROMPT

    # Build the tool schema with site IDs as an enum — the model can only return
    # a value from this list for site_id. Names are embedded in descriptions only.
    def build_tool(sites)
      site_enum = sites.map { |s| s[:id] }
      site_descriptions = sites.map { |s| "#{s[:name]} → #{s[:id]}" }.join(", ")

      {
        name:        TOOL_NAME,
        description: "Apply structured filters to the task list based on the operator's query.",
        input_schema: {
          type:       "object",
          properties: {
            site_id: {
              type:        ["string", "null"],
              enum:        site_enum + [nil],
              description: "UUID of the target site. Available sites: #{site_descriptions}"
            },
            workflow_status: {
              type:        ["string", "null"],
              enum:        ALLOWED_WORKFLOW_STATUSES + [nil],
              description: "Task workflow status"
            },
            priority: {
              type:        ["string", "null"],
              enum:        ALLOWED_PRIORITIES + [nil],
              description: "Task priority level"
            },
            created_after: {
              type:        ["string", "null"],
              description: "ISO 8601 datetime — only return tasks created after this time"
            },
            created_before: {
              type:        ["string", "null"],
              description: "ISO 8601 datetime — only return tasks created before this time"
            }
          },
          required: []
        }
      }
    end

    # Secondary validation layer — belt and suspenders even though the schema
    # already constrains values. Never trust model output without validation.
    def validate_filters(input, sites)
      valid_site_ids = sites.map { |s| s[:id] }

      site_id         = input["site_id"].in?(valid_site_ids)              ? input["site_id"]         : nil
      workflow_status = input["workflow_status"].in?(ALLOWED_WORKFLOW_STATUSES) ? input["workflow_status"] : nil
      priority        = input["priority"].in?(ALLOWED_PRIORITIES)              ? input["priority"]        : nil
      created_after   = safe_parse_datetime(input["created_after"])
      created_before  = safe_parse_datetime(input["created_before"])

      { site_id:, workflow_status:, priority:, created_after:, created_before: }
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
      ENV.fetch("FILTER_MODEL", DEFAULT_MODEL)
    end

    def report_exception(exception, message:, failure:)
      Rails.logger.error("[FilterService] #{message}: #{exception.class} - #{exception.message}")
      Observability.capture_exception(
        exception,
        tags: { service: "task_filter", failure: failure },
        extra: { query: @query },
        throttle_key: "task_filter:#{failure}:#{exception.class.name}",
      )
    end
  end
end
