module Sites
  # Builds a unified, reverse-chronological threat timeline for a single site.
  #
  # Merges five event sources into one sorted array:
  #   - signal_detected    ExternalSignal records within SIGNAL_RADIUS_KM in the lookback window
  #   - rule_fired         SignalRuleMatch records for this site
  #   - task_created       Task records created for this site
  #   - task_transitioned  AuditEvent records on Task entities belonging to this site
  #   - site_event         AuditEvent records on the Site entity itself
  #
  # Returns a plain Array of hashes (not a ServiceResult) so the controller
  # can paginate and serialize without an extra wrapper.
  class TimelineService < ApplicationService
    SIGNAL_RADIUS_KM = 200.0
    DEFAULT_DAYS     = 7
    MAX_LOOKBACK     = 90
    MAX_PER_KIND     = 150

    def initialize(site:, days: DEFAULT_DAYS)
      @site = site
      @days = days.to_i.clamp(1, MAX_LOOKBACK)
    end

    def call
      cutoff = @days.days.ago

      events = []
      events.concat(signal_events(cutoff))
      events.concat(rule_fire_events(cutoff))
      events.concat(task_created_events(cutoff))
      events.concat(task_audit_events(cutoff))
      events.concat(site_audit_events(cutoff))

      # Dedup by id (impossible in practice but safe), then sort newest-first.
      events.uniq { |e| e[:id] }
            .sort_by { |e| e[:occurred_at] }
            .reverse
    end

    private

    # ── event collectors ────────────────────────────────────────────────────────

    def signal_events(cutoff)
      ExternalSignal
        .near_point(@site.latitude, @site.longitude, SIGNAL_RADIUS_KM)
        .where("occurred_at > ?", cutoff)
        .order(occurred_at: :desc)
        .limit(MAX_PER_KIND)
        .filter_map { |sig| build_signal_event(sig) }
    end

    def rule_fire_events(cutoff)
      SignalRuleMatch
        .for_site(@site.id)
        .where("fired_at > ?", cutoff)
        .includes(:correlation_rule, :signal)
        .order(fired_at: :desc)
        .limit(MAX_PER_KIND)
        .map { |m| build_rule_fire_event(m) }
    end

    def task_created_events(cutoff)
      Task
        .where(site_id: @site.id)
        .where("created_at > ?", cutoff)
        .order(created_at: :desc)
        .limit(MAX_PER_KIND)
        .map { |t| build_task_created_event(t) }
    end

    def task_audit_events(cutoff)
      task_ids = Task.where(site_id: @site.id).pluck(:id)
      return [] if task_ids.empty?

      AuditEvent
        .where(entity_type: "Task", entity_id: task_ids)
        .where("occurred_at > ?", cutoff)
        .order(occurred_at: :desc)
        .limit(MAX_PER_KIND)
        .map { |e| build_audit_event(e, "task_transitioned") }
    end

    def site_audit_events(cutoff)
      AuditEvent
        .where(entity_type: "Site", entity_id: @site.id)
        .where("occurred_at > ?", cutoff)
        .order(occurred_at: :desc)
        .map { |e| build_audit_event(e, "site_event") }
    end

    # ── serializers ─────────────────────────────────────────────────────────────

    # Returns nil when the signal falls outside the exact Haversine radius
    # (near_point is a bounding-box pre-filter only).
    def build_signal_event(sig)
      dist_km = haversine(
        @site.latitude.to_f, @site.longitude.to_f,
        sig.lat.to_f, sig.lng.to_f
      )
      return nil if dist_km > SIGNAL_RADIUS_KM

      subtitle = "#{sig.source.upcase}"
      subtitle += " · mag #{sig.magnitude.to_f.round(2)}" if sig.magnitude.present?

      {
        id:          "sig_#{sig.id}",
        event_kind:  "signal_detected",
        occurred_at: sig.occurred_at.iso8601,
        title:       "#{sig.signal_type.humanize} detected #{dist_km.round(1)} km away",
        subtitle:    subtitle,
        actor:       "system",
        meta: {
          signal_id:    sig.id,
          signal_type:  sig.signal_type,
          source:       sig.source,
          distance_km:  dist_km.round(2),
          magnitude:    sig.magnitude,
          lat:          sig.lat,
          lng:          sig.lng
        }
      }
    end

    def build_rule_fire_event(match)
      rule_name = match.correlation_rule&.name || "Unknown rule"
      dist_km   = match.metadata&.dig("distance_km")
      actions   = Array(match.metadata&.dig("actions_taken"))

      subtitle_parts = [ "Confidence #{(match.confidence * 100).round}%" ]
      subtitle_parts << "#{dist_km.to_f.round(1)} km" if dist_km.present?
      subtitle_parts << actions.map { |a| a.tr("_", " ") }.join(", ") if actions.any?

      {
        id:              "match_#{match.id}",
        event_kind:      "rule_fired",
        occurred_at:     match.fired_at.iso8601,
        title:           "Rule '#{rule_name}' fired",
        subtitle:        subtitle_parts.join(" · "),
        actor:           "system",
        confidence:      match.confidence,
        workflow_status: match.workflow_status,
        meta: {
          match_id:       match.id,
          rule_id:        match.correlation_rule_id,
          rule_name:      rule_name,
          signal_type:    match.signal&.signal_type,
          distance_km:    dist_km,
          actions_taken:  actions
        }
      }
    end

    def build_task_created_event(task)
      {
        id:          "task_created_#{task.id}",
        event_kind:  "task_created",
        occurred_at: task.created_at.iso8601,
        title:       "Task created: #{task.title}",
        subtitle:    "#{task.priority} priority · #{task.workflow_status.tr('_', ' ')}",
        actor:       "system",
        meta: {
          task_id:         task.id,
          task_title:      task.title,
          priority:        task.priority,
          workflow_status: task.workflow_status
        }
      }
    end

    def build_audit_event(event, kind)
      action_label = (event.action || event.event_type).tr("_", " ")
      entity_label = event.entity_type.downcase

      {
        id:          "audit_#{event.id}",
        event_kind:  kind,
        occurred_at: event.occurred_at.iso8601,
        title:       "#{entity_label.capitalize} #{action_label}",
        subtitle:    nil,
        actor:       event.actor,
        meta: {
          audit_event_id: event.id,
          event_type:     event.event_type,
          action:         event.action,
          entity_type:    event.entity_type,
          entity_id:      event.entity_id
        }
      }
    end

    # ── helpers ─────────────────────────────────────────────────────────────────

    # Delegates to EvaluatorService to keep the Haversine formula in one place.
    def haversine(lat1, lon1, lat2, lon2)
      Correlations::EvaluatorService.haversine_km(lat1, lon1, lat2, lon2)
    end
  end
end
