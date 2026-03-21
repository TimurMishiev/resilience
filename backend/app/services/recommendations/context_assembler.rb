module Recommendations
  # Assembles a structured snapshot of the current operational state for use
  # by the rule engine and LLM enricher. All queries are read-only and kept
  # tight to avoid bloating the LLM prompt with irrelevant data.
  class ContextAssembler < ApplicationService
    STALE_ALERT_HOURS       = 4    # unacknowledged alert older than this = stale
    HIGH_CONF_THRESHOLD     = 0.70
    BULK_TRIAGE_THRESHOLD   = 5    # ≥5 unacknowledged alerts at one site → bulk suggest

    def call
      ServiceResult.success(context: build_context)
    rescue => e
      Rails.logger.error "[ContextAssembler] #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def build_context
      {
        assembled_at:       Time.current.iso8601,
        stale_alerts:       stale_alerts,
        high_conf_alerts:   high_conf_unacked_alerts,
        open_incidents:     open_incidents,
        overdue_tasks:      overdue_tasks,
        flaggable_sites:    flaggable_sites,
        bulk_triage_sites:  bulk_triage_sites,
        risk_snapshots:     risk_snapshots,
      }
    end

    # Unacknowledged alerts older than STALE_ALERT_HOURS
    def stale_alerts
      SignalRuleMatch
        .unacknowledged
        .where("fired_at < ?", STALE_ALERT_HOURS.hours.ago)
        .includes(:site, :correlation_rule, :signal)
        .order(fired_at: :asc)
        .limit(20)
        .map { |m| serialize_match(m) }
    end

    # High-confidence unacknowledged alerts (≥70%) — prime escalation candidates
    def high_conf_unacked_alerts
      SignalRuleMatch
        .unacknowledged
        .high_confidence
        .where("fired_at > ?", 24.hours.ago)
        .includes(:site, :correlation_rule, :signal)
        .order(confidence: :desc)
        .limit(10)
        .map { |m| serialize_match(m) }
    end

    # Active incidents (open + acknowledged), ordered critical-first
    def open_incidents
      Incident
        .active
        .by_severity
        .includes(:site, :signal_rule_matches)
        .limit(10)
        .map { |i| serialize_incident(i) }
    end

    # Tasks blocked or in-progress for > 48 hours
    def overdue_tasks
      Task
        .where(workflow_status: %w[blocked in_progress])
        .where("updated_at < ?", 48.hours.ago)
        .includes(:site)
        .limit(10)
        .map { |t| serialize_task(t) }
    end

    # Sites with high risk score (from latest snapshot) but not yet flagged
    def flaggable_sites
      # Pull recent high-score snapshots then resolve sites
      # score column is integer 0-100
      recent_high = SiteRiskSnapshot
        .where("score >= ?", 75)
        .where("recorded_at > ?", 24.hours.ago)
        .order(score: :desc)
        .limit(10)

      site_ids = recent_high.pluck(:site_id).uniq
      return [] if site_ids.empty?

      scores = recent_high.each_with_object({}) { |r, h| h[r.site_id] ||= r.score }

      Site.active.where(flagged_at: nil).where(id: site_ids).limit(5).map do |s|
        { id: s.id, name: s.name, risk_score: (scores[s.id].to_f / 100.0) }
      end
    rescue => e
      Rails.logger.debug "[ContextAssembler] flaggable_sites error: #{e.message}"
      []
    end

    # Sites where many unacknowledged alerts are piling up
    def bulk_triage_sites
      SignalRuleMatch
        .unacknowledged
        .where("fired_at > ?", 24.hours.ago)
        .where.not(site_id: nil)
        .group(:site_id)
        .having("COUNT(*) >= ?", BULK_TRIAGE_THRESHOLD)
        .count
        .map { |site_id, count| { site_id: site_id, unacked_count: count } }
    end

    # Latest risk snapshots (per-site most-recent)
    def risk_snapshots
      SiteRiskSnapshot
        .order(recorded_at: :desc)
        .limit(5)
        .map { |r| { site_id: r.site_id, score: r.score, recorded_at: r.recorded_at.iso8601 } }
    rescue => e
      Rails.logger.debug "[ContextAssembler] risk_snapshots error: #{e.message}"
      []
    end

    # ── Serializers ─────────────────────────────────────────────────────────────

    def serialize_match(m)
      {
        id:               m.id,
        site_id:          m.site_id,
        site_name:        m.site&.name,
        rule_name:        m.correlation_rule&.name || (m.metadata["geofence_breach"] ? "Geofence Monitor" : nil),
        signal_type:      m.signal&.signal_type,
        confidence:       m.confidence.to_f,
        fired_at:         m.fired_at&.iso8601,
        workflow_status:  m.workflow_status,
        geofence_breach:  m.metadata["geofence_breach"] == true,
      }
    end

    def serialize_incident(i)
      {
        id:          i.id,
        title:       i.title,
        status:      i.status,
        severity:    i.severity,
        confidence:  i.confidence.to_f,
        alert_count: i.signal_rule_matches.size,
        site_id:     i.site_id,
        site_name:   i.site&.name,
        opened_at:   i.opened_at.iso8601,
      }
    end

    def serialize_task(t)
      {
        id:              t.id,
        title:           t.title,
        priority:        t.priority,
        workflow_status: t.workflow_status,
        site_id:         t.site_id,
        site_name:       t.site&.name,
        updated_at:      t.updated_at.iso8601,
      }
    end
  end
end
