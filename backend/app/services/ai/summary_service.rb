module Ai
  # Generates a grounded operational summary from real audit events.
  # Passes actual event data as context — the model cannot invent events.
  # Validates citations: only audit event IDs we provided are allowed through.
  class SummaryService < ApplicationService
    ALLOWED_SUMMARY_TYPES = %w[site_activity readiness_change leadership_briefing].freeze
    MAX_EVENTS = 50

    def initialize(summary_type:, site_id: nil, from: nil, to: nil)
      @summary_type = summary_type.to_s
      @site_id      = site_id
      @from         = from
      @to           = to
    end

    def call
      unless @summary_type.in?(ALLOWED_SUMMARY_TYPES)
        return ServiceResult.failure(errors: ["Invalid summary_type. Must be one of: #{ALLOWED_SUMMARY_TYPES.join(', ')}"])
      end

      events = fetch_events

      if events.empty?
        return ServiceResult.failure(errors: ["No audit events found for the specified parameters"])
      end

      client = Anthropic::Client.new(api_key: ENV.fetch("ANTHROPIC_API_KEY"))

      response = client.messages.create(
        model:      "claude-haiku-4-5",
        max_tokens: 1024,
        system:     build_system_prompt,
        messages:   [ { role: "user", content: build_user_content(events) } ]
      )

      raw    = response.content.first.text.gsub(/\A```(?:json)?\n?/, '').gsub(/\n?```\z/, '').strip
      parsed = JSON.parse(raw)

      # Validate citations — reject any ID the model invented that was not in our context
      valid_ids = events.map { |e| e[:id] }.to_set
      citations = Array(parsed["citations"]).select { |id| valid_ids.include?(id) }

      ServiceResult.success({ summary: parsed["summary"].to_s.strip, citations: })
    rescue JSON::ParserError
      ServiceResult.failure(errors: ["AI returned an unparseable response"])
    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue => e
      ServiceResult.failure(errors: ["AI service error: #{e.message}"])
    end

    private

    def fetch_events
      scope = AuditEvent.order(occurred_at: :desc).limit(MAX_EVENTS)

      if @site_id.present?
        task_ids = Task.where(site_id: @site_id).pluck(:id)
        scope = scope.where(entity_id: task_ids)
      end

      scope = scope.where("occurred_at >= ?", @from) if @from.present?
      scope = scope.where("occurred_at <= ?", @to)   if @to.present?

      scope.map do |e|
        {
          id:              e.id,
          actor:           e.actor,
          entity_type:     e.entity_type,
          entity_id:       e.entity_id,
          event_type:      e.event_type,
          action:          e.action,
          before_snapshot: e.before_snapshot,
          after_snapshot:  e.after_snapshot,
          occurred_at:     e.occurred_at.iso8601
        }
      end
    end

    def build_system_prompt
      focus = case @summary_type
              when "site_activity"
                "Summarise recent activity: what tasks changed, who acted, and current state."
              when "readiness_change"
                "Focus on task status transitions that affected readiness. Highlight resolved and blocked tasks."
              when "leadership_briefing"
                "Write a concise executive briefing for senior leadership. Focus on operational status, critical issues, and recent resolutions. Be direct and factual."
              end

      <<~PROMPT
        You are an operational briefing system for a mission operations console.
        Your summaries are grounded exclusively in the audit events provided to you.
        Do not invent facts, names, actors, or events not present in the data.

        #{focus}

        Respond with ONLY a valid JSON object — no markdown, no explanation:
        {
          "summary":   "<your operational summary as plain prose>",
          "citations": ["<audit_event_id_1>", "<audit_event_id_2>"]
        }

        The citations array must contain only IDs of audit events you actually referenced.
      PROMPT
    end

    def build_user_content(events)
      lines = events.map.with_index(1) do |e, i|
        before = e[:before_snapshot] ? " | before: #{e[:before_snapshot].to_json}" : ""
        "#{i}. [#{e[:id]}] #{e[:occurred_at]} #{e[:actor]} — #{e[:event_type]} #{e[:entity_type]}#{before} → #{e[:after_snapshot].to_json}"
      end.join("\n")

      "Generate a #{@summary_type.humanize.downcase} from these #{events.length} audit events:\n\n#{lines}"
    end
  end
end
