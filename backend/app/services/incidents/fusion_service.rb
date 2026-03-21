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
    FUSION_WINDOW   = 6.hours
    SEVERITY_ORDER  = Incident::SEVERITY_ORDER

    def initialize(match:)
      @match = match
    end

    def call
      return ServiceResult.success(incident: nil, action: :skipped) unless @match.site_id

      incident, action = find_or_create_incident
      @match.update_column(:incident_id, incident.id)

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
      site_name   = @match.site&.name || "unknown site"
      dist        = @match.metadata["distance_km"]&.round(1)
      dist_str    = dist ? " (#{dist} km away)" : ""

      Incident.create!(
        title:            "#{signal_type} activity near #{site_name}",
        site_id:          @match.site_id,
        area_of_operation_id: @match.site&.area_of_operation_id,
        opened_at:        @match.fired_at || Time.current,
        confidence:       @match.confidence.to_f,
        severity:         severity_from_confidence(@match.confidence.to_f),
        fusion_rationale: "Opened: rule '#{rule_name}' fired on #{signal_type.downcase} signal#{dist_str} " \
                          "(conf #{(@match.confidence.to_f * 100).round}%)."
      )
    end

    def attach_to_existing(incident)
      rule_name  = @match.correlation_rule&.name || "Geofence Monitor"
      addition   = "· Rule '#{rule_name}' fired (conf #{(@match.confidence.to_f * 100).round}%)."

      new_rationale = [incident.fusion_rationale, addition].compact.join(" ")
      new_conf      = [@match.confidence.to_f, incident.confidence.to_f].max
      new_sev       = higher_severity(incident.severity, severity_from_confidence(@match.confidence.to_f))

      incident.update!(
        fusion_rationale: new_rationale,
        confidence:       new_conf,
        severity:         new_sev,
        updated_at:       Time.current   # explicit refresh so FUSION_WINDOW stays alive
      )
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
