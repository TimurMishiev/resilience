module Ai
  # Translates a natural language operator query into structured task filter params.
  # Grounds the output by injecting real site IDs before sending to the model.
  # Validates every returned value against known enums — never trusts model output blindly.
  class FilterService < ApplicationService
    ALLOWED_WORKFLOW_STATUSES = %w[new triaged in_progress blocked resolved].freeze
    ALLOWED_PRIORITIES        = %w[low normal high critical].freeze

    def initialize(query:)
      @query = query.to_s.strip
    end

    def call
      return ServiceResult.failure(errors: ["Query cannot be blank"]) if @query.blank?

      sites  = Site.all.map { |s| { id: s.id, name: s.name } }
      client = Anthropic::Client.new(api_key: ENV.fetch("ANTHROPIC_API_KEY"))

      response = client.messages.create(
        model:      "claude-haiku-4-5",
        max_tokens: 512,
        system:     build_system_prompt(sites),
        messages:   [ { role: "user", content: @query } ]
      )

      raw     = response.content.first.text.gsub(/\A```(?:json)?\n?/, '').gsub(/\n?```\z/, '').strip
      parsed  = JSON.parse(raw)
      filters = validate_filters(parsed, sites)

      ServiceResult.success({ original_query: @query, filters: filters })
    rescue JSON::ParserError
      ServiceResult.failure(errors: ["AI returned an unparseable response"])
    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue => e
      ServiceResult.failure(errors: ["AI service error: #{e.message}"])
    end

    private

    def build_system_prompt(sites)
      site_list = sites.map { |s| "  - \"#{s[:name]}\" → #{s[:id]}" }.join("\n")

      <<~PROMPT
        You are a filter translator for a mission operations console.
        Convert the operator's natural language query into a JSON filter object.

        Available sites:
        #{site_list}

        Valid workflow_status values: #{ALLOWED_WORKFLOW_STATUSES.join(", ")}
        Valid priority values: #{ALLOWED_PRIORITIES.join(", ")}

        Respond with ONLY a valid JSON object — no markdown, no explanation:
        {
          "site_id":        "<uuid from the site list above, or null>",
          "workflow_status": "<one of the valid statuses, or null>",
          "priority":        "<one of the valid priorities, or null>",
          "created_after":   "<ISO 8601 datetime, or null>",
          "created_before":  "<ISO 8601 datetime, or null>"
        }

        Rules:
        - site_id must be an exact UUID from the list above, or null.
        - workflow_status and priority must be exact string matches, or null.
        - If something is not mentioned or unclear, use null.
      PROMPT
    end

    def validate_filters(parsed, sites)
      valid_site_ids = sites.map { |s| s[:id] }

      site_id        = parsed["site_id"].in?(valid_site_ids)          ? parsed["site_id"]        : nil
      workflow_status = parsed["workflow_status"].in?(ALLOWED_WORKFLOW_STATUSES) ? parsed["workflow_status"] : nil
      priority        = parsed["priority"].in?(ALLOWED_PRIORITIES)              ? parsed["priority"]        : nil
      created_after   = safe_parse_datetime(parsed["created_after"])
      created_before  = safe_parse_datetime(parsed["created_before"])

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
