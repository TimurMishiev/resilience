module Incidents
  # Groups a newly-created SignalRuleMatch into an existing open Incident, or
  # opens a new Incident if no recent one exists for the same site.
  #
  # Fusion logic (explicit and explainable):
  #   - Spatial key:   same site_id
  #   - Temporal key:  any OPEN or ACKNOWLEDGED incident at that site updated
  #                    within FUSION_WINDOW (6 hours).  The window is sliding,
  #                    not bucketed, so a quiet period naturally ends an incident.
  #   - Severity:      ratchets upward if the new alert is higher-confidence
  #                    than the existing incident; never auto-downgrades.
  #   - Rationale:     every fusion decision is recorded in fusion_rationale
  #                    as a human-readable audit trail (visible on the incident
  #                    detail page).
  #
  # Skips fusion (no-op) if the match has no site_id.
  class FusionService < ApplicationService
    FUSION_WINDOW        = 6.hours
    SEVERITY_ORDER       = Incident::SEVERITY_ORDER
    # Cap the in-row rationale at 5 KB.  After this point every new fusion still
    # updates confidence/severity/updated_at (keeping the incident alive), but
    # further text is omitted.  The full history is always available via AuditEvents.
    RATIONALE_MAX_BYTES  = 5_000
    RATIONALE_OVERFLOW   = " [further fusions omitted — see audit log for full history]"

    def initialize(match:)
      @match = match
    end

    def call
      return ServiceResult.success(incident: nil, action: :skipped) unless @match.site_id

      incident, action = nil, nil

      # Serialise concurrent fusion attempts for the same site by locking the
      # site row FOR UPDATE inside a transaction.  Two threads racing on the same
      # site_id will queue here; the second one re-reads an incident that the
      # first already created and attaches to it rather than opening a parallel one.
      ActiveRecord::Base.transaction do
        # Lock site row — any other fusion call for this site will block here
        # until our transaction commits, then re-read the (now existing) incident.
        # Capture the freshly-loaded row (full columns) instead of relying on
        # `@match.site`. The match's cached site association can be a partial-
        # select object when the producer (e.g. EvaluateRecentJob) loaded sites
        # without `area_of_operation_id` for memory efficiency. Reading the
        # cached partial AR via `@match.site.area_of_operation_id` raised
        # MissingAttributeError silently swallowed by the caller's rescue, so
        # geofence-breach incidents never opened in production. Using the
        # FOR-UPDATE-locked row is both the correct concurrency primitive AND
        # the defensive read that prevents recurrence from any future caller.
        @locked_site = Site.lock("FOR UPDATE").find(@match.site_id)

        incident, action = find_or_create_incident
        @match.update_column(:incident_id, incident.id)
      end

      # Trigger a recommendation generation pass whenever a new incident is opened.
      # Done outside the transaction so a job-queue failure can't roll back the DB write.
      Recommendations::GenerationJob.perform_later if action == :created

      ServiceResult.success(incident: incident, action: action)
    rescue ActiveRecord::RecordInvalid => e
      Rails.logger.warn "[FusionService] failed match=#{@match.id}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    # ---------------------------------------------------------------------------

    def find_or_create_incident
      existing = Incident
        .where(site_id: @match.site_id, status: %w[open acknowledged])
        .where(updated_at: FUSION_WINDOW.ago..Time.current)
        .order(updated_at: :desc)
        .first

      if existing
        attach_to_existing(existing)
        [existing, :attached]
      else
        [create_new_incident, :created]
      end
    end

    def create_new_incident
      rule_name   = @match.correlation_rule&.name || "Geofence Monitor"
      signal_type = (@match.metadata["signal_type"] || @match.signal&.signal_type || "signal").humanize
      # Read site fields from the FOR-UPDATE-locked row (always full columns)
      # rather than the match's cached AR association (which may be partial-
      # select). See the comment in #call for the production-bug context.
      site_name   = @locked_site&.name || "unknown site"
      dist        = @match.metadata["distance_km"]&.round(1)
      dist_str    = dist ? " (#{dist} km away)" : ""

      incident = Incident.create!(
        title:            "#{signal_type} activity near #{site_name}",
        site_id:          @match.site_id,
        area_of_operation_id: @locked_site&.area_of_operation_id,
        opened_at:        @match.fired_at || Time.current,
        confidence:       @match.confidence.to_f,
        severity:         severity_from_confidence(@match.confidence.to_f),
        fusion_rationale: "Opened: rule '#{rule_name}' fired on #{signal_type.downcase} signal#{dist_str} " \
                          "(conf #{(@match.confidence.to_f * 100).round}%)."
      )
      Audit::EventWriter.write(
        actor:           "system",
        entity_type:     "Incident",
        entity_id:       incident.id,
        event_type:      "incident.opened",
        action:          "create",
        before_snapshot: {},
        after_snapshot:  { site_id: incident.site_id, severity: incident.severity, confidence: incident.confidence },
        metadata:        { match_id: @match.id, rule_name: rule_name },
        correlation_id:  SecureRandom.uuid,
      )
      incident
    end

    def attach_to_existing(incident)
      rule_name  = @match.correlation_rule&.name || "Geofence Monitor"
      addition   = "· Rule '#{rule_name}' fired (conf #{(@match.confidence.to_f * 100).round}%)."

      new_rationale = build_rationale(incident.fusion_rationale.to_s, addition)
      new_conf      = [@match.confidence.to_f, incident.confidence.to_f].max
      new_sev       = higher_severity(incident.severity, severity_from_confidence(@match.confidence.to_f))

      incident.update!(
        fusion_rationale: new_rationale,
        confidence:       new_conf,
        severity:         new_sev,
        updated_at:       Time.current   # explicit refresh so FUSION_WINDOW stays alive
      )
      Audit::EventWriter.write(
        actor:           "system",
        entity_type:     "Incident",
        entity_id:       incident.id,
        event_type:      "incident.fusion_attached",
        action:          "update",
        before_snapshot: { confidence: incident.confidence_before_last_save, severity: incident.severity_before_last_save },
        after_snapshot:  { confidence: new_conf, severity: new_sev },
        metadata:        { match_id: @match.id, rule_name: rule_name },
        correlation_id:  SecureRandom.uuid,
      )
    end

    # Appends +addition+ to +current+ unless the rationale has already hit the
    # byte cap.  Once the cap is reached the overflow sentinel is written once
    # and then no further changes are made to the text on subsequent fusions.
    def build_rationale(current, addition)
      return current if current.end_with?(RATIONALE_OVERFLOW)

      candidate = [current.presence, addition].compact.join(" ")
      return candidate if candidate.bytesize <= RATIONALE_MAX_BYTES

      overflow_suffix = build_overflow_suffix(addition)
      available_bytes = [RATIONALE_MAX_BYTES - overflow_suffix.bytesize, 0].max
      preserved = current.to_s.byteslice(0, available_bytes).to_s.scrub.rstrip

      "#{preserved}#{overflow_suffix}"
    end

    def build_overflow_suffix(addition)
      latest_excerpt = addition.to_s.squish.byteslice(0, 96).to_s.scrub.rstrip
      latest_excerpt.present? ? " [latest: #{latest_excerpt}]#{RATIONALE_OVERFLOW}" : RATIONALE_OVERFLOW
    end

    # ── helpers ─────────────────────────────────────────────────────────────────

    # Returns the higher of the two severity strings.
    def higher_severity(a, b)
      rank_a = SEVERITY_ORDER.index(a) || 0
      rank_b = SEVERITY_ORDER.index(b) || 0
      rank_a >= rank_b ? a : b
    end

    def severity_from_confidence(conf)
      case conf
      when 0.8..Float::INFINITY then "critical"
      when 0.6...0.8            then "high"
      when 0.4...0.6            then "moderate"
      else                           "low"
      end
    end
  end
end
