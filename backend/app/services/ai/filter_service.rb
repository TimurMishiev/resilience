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
    ALLOWED_WORKFLOW_STATUSES = %w[new triaged in_progress blocked resolved].freeze
    ALLOWED_PRIORITIES        = %w[low normal high critical].freeze
    TOOL_NAME                 = "apply_task_filters"

    def initialize(query:)
      @query = query.to_s.strip
    end

    def call
      return ServiceResult.failure(errors: ["Query cannot be blank"]) if @query.blank?

      sites  = Site.all.map { |s| { id: s.id, name: s.name } }
      client = Anthropic::Client.new(api_key: ENV.fetch("ANTHROPIC_API_KEY"))

      response = client.messages.create(
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system:     SYSTEM_PROMPT,
        tools:      [ build_tool(sites) ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages:   [ { role: "user", content: @query } ]
      )

      tool_block = response.content.find { |b| b.type == "tool_use" && b.name == TOOL_NAME }
      return ServiceResult.failure(errors: ["AI did not return a filter tool call"]) unless tool_block

      filters = validate_filters(tool_block.input, sites)
      ServiceResult.success({ original_query: @query, filters: filters })

    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue => e
      ServiceResult.failure(errors: ["AI service error: #{e.message}"])
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
      Time.zone.parse(value.to_s).iso8601
    rescue ArgumentError, TypeError
      nil
    end
  end
end
