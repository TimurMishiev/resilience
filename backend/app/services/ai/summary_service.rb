module Ai
  # Generates a grounded operational summary from three intelligence sources:
  #
  #   1. AuditEvent records   — task/site state transitions (citable by UUID)
  #   2. ExternalSignal records — nearby signals (informational context, not citable)
  #   3. SignalRuleMatch records — rule firings with confidence scores (informational)
  #
  # Citation validation: only AuditEvent IDs that were sent to the model are
  # accepted as citations. Signal and match IDs are never offered as citation
  # candidates, so the model cannot hallucinate references to them.
  #
  # When site_id is provided:
  #   - AuditEvents  scoped to that Site + its Tasks
  #   - ExternalSignals within SIGNAL_RADIUS_KM of the site (last CONTEXT_WINDOW_HOURS)
  #   - SignalRuleMatches for that site (last CONTEXT_WINDOW_HOURS)
  #
  # When site_id is omitted (global briefing):
  #   - AuditEvents across all entities (no scope)
  #   - No ExternalSignals (no focal point to center proximity search on)
  #   - Recent SignalRuleMatches across all sites (top 10)
  class SummaryService < ApplicationService
    ALLOWED_SUMMARY_TYPES = %w[site_activity readiness_change leadership_briefing].freeze
    BREAKER_SERVICE = "summary"

    MAX_AUDIT_EVENTS  = 40
    MAX_SIGNALS       = 20
    MAX_RULE_FIRES    = 10
    SIGNAL_RADIUS_KM  = 200.0
    CONTEXT_WINDOW_HOURS = 72
    DEFAULT_MODEL             = "claude-haiku-4-5-20251001"
    ANTHROPIC_TIMEOUT_SECONDS = 30
    ANTHROPIC_MAX_RETRIES     = 2

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
      return ServiceResult.failure(errors: ["AI temporarily unavailable. Please retry shortly."]) if Ai::CircuitBreaker.open?(service: BREAKER_SERVICE)

      @site    = Site.find(@site_id) if @site_id.present?
      events   = fetch_events
      signals  = fetch_signals
      matches  = fetch_matches

      if events.empty? && signals.empty? && matches.empty?
        return ServiceResult.failure(errors: ["No operational data found for the specified parameters"])
      end

      client = Anthropic::Client.new(
        api_key: ENV.fetch("ANTHROPIC_API_KEY"),
        timeout: ANTHROPIC_TIMEOUT_SECONDS,
        max_retries: ANTHROPIC_MAX_RETRIES,
      )

      ai_start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      response = client.messages.create(
        model:      summary_model,
        max_tokens: 1024,
        system:     build_system_prompt,
        messages:   [ { role: "user", content: build_user_content(events, signals, matches) } ]
      )
      Metrics::Recorder.record_ai_call(service: "summary", duration_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - ai_start) * 1000).round(1))

      raw    = response.content.first.text.gsub(/\A```(?:json)?\n?/, '').gsub(/\n?```\z/, '').strip
      parsed = JSON.parse(raw)

      # Citation validation — only AuditEvent IDs we provided pass through.
      # Signal/match IDs are never in the citable set, so the model cannot
      # fabricate a citation UUID for an event we did not send.
      valid_ids = events.map { |e| e[:id] }.to_set
      citations = Array(parsed["citations"]).select { |id| valid_ids.include?(id) }

      Ai::CircuitBreaker.record_success(service: BREAKER_SERVICE)
      ServiceResult.success(
        summary:   parsed["summary"].to_s.strip,
        citations: citations,
        context_counts: {
          audit_events: events.size,
          signals:      signals.size,
          rule_fires:   matches.size
        }
      )
    rescue JSON::ParserError
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      ServiceResult.failure(errors: ["AI returned an unparseable response"])
    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue ActiveRecord::RecordNotFound
      ServiceResult.failure(errors: ["Site not found"])
    rescue Anthropic::Errors::APITimeoutError => e
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "Summary generation timed out", failure: "timeout")
      ServiceResult.failure(errors: ["Summary generation timed out"])
    rescue => e
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "AI service error: #{e.message}", failure: "error")
      ServiceResult.failure(errors: ["AI service error: #{e.message}"])
    end

    private

    # ── data fetchers ────────────────────────────────────────────────────────────

    def fetch_events
      scope = AuditEvent.order(occurred_at: :desc).limit(MAX_AUDIT_EVENTS)

      if @site.present?
        task_ids = Task.where(site_id: @site.id).pluck(:id)

        # Include both Site-level events and Task-level events for this site.
        # This was previously missing Site events, making the briefing blind to
        # status changes, flags, and unflag actions on the site itself.
        if task_ids.any?
          scope = scope.where(
            "(entity_type = 'Site' AND entity_id = ?) OR (entity_type = 'Task' AND entity_id IN (?))",
            @site.id, task_ids
          )
        else
          scope = scope.where(entity_type: "Site", entity_id: @site.id)
        end
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

    # Returns ExternalSignal records near the site within the context window.
    # Uses the PostGIS-backed near_point path on the supported baseline and
    # retains exact-Haversine fallback logic only for legacy non-PostGIS setups.
    # Returns [] when no site is specified — can't run proximity search without a center.
    def fetch_signals
      return [] unless @site.present?

      cutoff = context_upper_bound - CONTEXT_WINDOW_HOURS.hours
      scope  = ExternalSignal
        .near_point(@site.latitude, @site.longitude, SIGNAL_RADIUS_KM)
        .where("occurred_at > ? AND occurred_at <= ?", cutoff, context_upper_bound)
        .order(occurred_at: :desc)

      exact_signals =
        if ExternalSignal.connection.extension_enabled?("postgis")
          scope.limit(MAX_SIGNALS).map { |signal| [signal, signal_distance_km(signal)] }
        else
          exhaustive_exact_signals(scope, limit: MAX_SIGNALS)
        end

      exact_signals.map do |sig, dist|
          {
            signal_type:  sig.signal_type,
            source:       sig.source,
            distance_km:  dist.round(1),
            magnitude:    sig.magnitude,
            occurred_at:  sig.occurred_at.iso8601,
            raw_payload:  sig.raw_payload
          }
      end
    end

    # Returns recent SignalRuleMatch records.
    # Site-scoped when @site is set; last 10 across all sites otherwise (leadership briefing).
    def fetch_matches
      cutoff = context_upper_bound - CONTEXT_WINDOW_HOURS.hours
      scope  = SignalRuleMatch
        .where("fired_at > ? AND fired_at <= ?", cutoff, context_upper_bound)
        .includes(:correlation_rule, :signal, :site)
        .order(fired_at: :desc)
        .limit(MAX_RULE_FIRES)

      scope = scope.for_site(@site.id) if @site.present?

      scope.map do |m|
        {
          rule_name:       m.correlation_rule&.name || "Unknown rule",
          confidence:      m.confidence,
          workflow_status: m.workflow_status,
          fired_at:        m.fired_at.iso8601,
          site_name:       m.site&.name,
          signal_type:     m.signal&.signal_type,
          distance_km:     m.metadata&.dig("distance_km"),
          actions_taken:   Array(m.metadata&.dig("actions_taken"))
        }
      end
    end

    # ── prompt builders ──────────────────────────────────────────────────────────

    def build_system_prompt
      site_ctx = @site ? "for #{@site.name}" : "across all sites"

      focus = case @summary_type
              when "site_activity"
                "Summarise recent activity #{site_ctx}: what tasks changed, who acted, what signals were detected, and the current operational state."
              when "readiness_change"
                "Focus on task status transitions that affected readiness #{site_ctx}. Highlight resolved and blocked tasks. Note any signals or rule fires that may have prompted action."
              when "leadership_briefing"
                "Write a concise executive briefing for senior leadership. Cover operational status, critical issues, notable intelligence signals, active alerts, and recent resolutions. Be direct, specific, and factual. Include signal intelligence context where relevant."
              end

      <<~PROMPT
        You are an operational briefing system for a mission operations console.
        Your summaries are grounded in the data provided: audit events, intelligence signals, and correlation rule fires.
        Do not invent facts, names, actors, events, or signal details not present in the data.

        #{focus}

        You will receive three context blocks:
        - AUDIT TRAIL: task and site state changes with before/after snapshots (these have citable IDs)
        - INTELLIGENCE SIGNALS: external feed data (aircraft, seismic, vessel, GPS jamming, wildfire, conflict events, disaster alerts) near the site
        - RULE FIRES: correlation engine alerts that fired, with confidence scores and actions taken

        Synthesise all three into a coherent operational narrative. Reference signals and rule fires in
        your prose where relevant (e.g. "a GPS jamming signal 43km away triggered rule X at 87% confidence").
        Only cite IDs from the AUDIT TRAIL — signals and rule fires are informational context, not citable entities.

        Respond with ONLY a valid JSON object — no markdown, no explanation:
        {
          "summary":   "<your operational summary as plain prose, 3–6 sentences>",
          "citations": ["<audit_event_id_1>", "<audit_event_id_2>"]
        }

        The citations array must contain only IDs of audit events you actually referenced.
      PROMPT
    end

    def build_user_content(events, signals, matches)
      parts = []

      # ── Audit trail ──
      if events.any?
        lines = events.map.with_index(1) do |e, i|
          before = e[:before_snapshot] ? " | before: #{e[:before_snapshot].to_json}" : ""
          "#{i}. [#{e[:id]}] #{e[:occurred_at]} #{e[:actor]} — #{e[:event_type]} #{e[:entity_type]}#{before} → #{e[:after_snapshot].to_json}"
        end.join("\n")
        parts << "AUDIT TRAIL (#{events.length} events):\n#{lines}"
      else
        parts << "AUDIT TRAIL: (none in time range)"
      end

      # ── Intelligence signals ──
      if signals.any?
        lines = signals.map do |s|
          base = "  #{s[:signal_type].humanize} | #{s[:source].upcase} | #{s[:distance_km]}km away | #{s[:occurred_at]}"
          base += " | mag #{s[:magnitude].to_f.round(2)}" if s[:magnitude].present?

          # Enrich with type-specific payload fields
          p = s[:raw_payload] || {}
          case s[:signal_type]
          when "conflict_event"
            details = [
              p["country"].presence && "country: #{p['country']}",
              p["actor1"].presence  && "actor: #{p['actor1']}",
              p["fatalities"].present? && p["fatalities"].to_i > 0 && "fatalities: #{p['fatalities']}",
              p["event_type"].presence && "type: #{p['event_type']}"
            ].compact
            base += " | #{details.join(' · ')}" if details.any?
          when "disaster_alert"
            details = [
              p["alert_level"].presence   && "alert: #{p['alert_level']}",
              p["event_type_name"].presence && "type: #{p['event_type_name']}",
              p["severity_text"].presence  && "severity: #{p['severity_text'].to_s.truncate(80)}"
            ].compact
            base += " | #{details.join(' · ')}" if details.any?
          when "seismic_event"
            base += " | M#{s[:magnitude].to_f.round(1)}" if s[:magnitude].present?
          end

          base
        end.join("\n")
        parts << "INTELLIGENCE SIGNALS (#{signals.length} within #{SIGNAL_RADIUS_KM.to_i}km, last #{CONTEXT_WINDOW_HOURS}h):\n#{lines}"
      else
        parts << "INTELLIGENCE SIGNALS: (none detected in area)"
      end

      # ── Rule fires ──
      if matches.any?
        lines = matches.map do |m|
          conf    = "#{(m[:confidence] * 100).round}% confidence"
          dist    = m[:distance_km] ? " | #{m[:distance_km].to_f.round(1)}km" : ""
          actions = m[:actions_taken].any? ? " | actions: #{m[:actions_taken].join(', ')}" : ""
          site    = m[:site_name] && !@site ? " | site: #{m[:site_name]}" : ""
          "  '#{m[:rule_name]}' fired #{m[:fired_at]} | #{conf}#{dist}#{actions} | status: #{m[:workflow_status]}#{site}"
        end.join("\n")
        parts << "RULE FIRES (#{matches.length} in last #{CONTEXT_WINDOW_HOURS}h):\n#{lines}"
      else
        parts << "RULE FIRES: (none in last #{CONTEXT_WINDOW_HOURS}h)"
      end

      scope_label = @site ? "for site #{@site.name}" : "across all sites"
      "Generate a #{@summary_type.humanize.downcase} #{scope_label}:\n\n#{parts.join("\n\n")}"
    end

    def exhaustive_exact_signals(scope, limit:)
      results    = []
      offset     = 0
      batch_size = limit

      while results.length < limit
        batch = scope.limit(batch_size).offset(offset).to_a
        break if batch.empty?

        batch.each do |signal|
          distance = signal_distance_km(signal)
          next if distance > SIGNAL_RADIUS_KM

          results << [signal, distance]
          break if results.length >= limit
        end

        offset += batch.length
      end

      results
    end

    def signal_distance_km(signal)
      Correlations::EvaluatorService.haversine_km(
        signal.lat.to_f, signal.lng.to_f,
        @site.latitude.to_f, @site.longitude.to_f
      )
    end

    def summary_model
      ENV.fetch("SUMMARY_MODEL", DEFAULT_MODEL)
    end

    def context_upper_bound
      @to || Time.current
    end

    def report_exception(exception, message:, failure:)
      Rails.logger.error("[SummaryService] #{message}: #{exception.class} - #{exception.message}")
      Observability.capture_exception(
        exception,
        tags: { service: "summary", failure: failure },
        extra: { summary_type: @summary_type, site_id: @site_id },
        throttle_key: "summary:#{failure}:#{exception.class.name}",
      )
    end
  end
end
