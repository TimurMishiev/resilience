module Recommendations
  # Assembles a structured snapshot of the current operational state for use
  # by the rule engine and LLM enricher. All queries are read-only and kept
  # tight to avoid bloating the LLM prompt with irrelevant data.
  class ContextAssembler < ApplicationService
    STALE_ALERT_HOURS       = 4    # unacknowledged alert older than this = stale
    HIGH_CONF_THRESHOLD     = 0.70
    BULK_TRIAGE_THRESHOLD   = 5    # ≥5 unacknowledged alerts at one site → bulk suggest
    # Caps the number of sites loaded into the LLM context window for posture
    # enrichment. Keep this tight — the LLM prompt budget is finite and posture
    # data beyond ~500 sites produces no useful signal at the resolution the
    # rule engine operates at.
    POSTURE_SITE_LIMIT      = 500

    def call
      ServiceResult.success(context: build_context)
    rescue => e
      Rails.logger.error "[ContextAssembler] #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def build_context
      {
        assembled_at:                  Time.current.iso8601,
        stale_alerts:                  stale_alerts,
        high_conf_alerts:              high_conf_unacked_alerts,
        open_incidents:                open_incidents,
        overdue_tasks:                 overdue_tasks,
        flaggable_sites:               flaggable_sites,
        bulk_triage_sites:             bulk_triage_sites,
        risk_snapshots:                risk_snapshots,
        posture_by_site_id:            posture_by_site_id,
        asset_availability:            asset_availability,
        available_assets:              available_assets,
        unassigned_high_priority_tasks: unassigned_high_priority_tasks,
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

      # site_ids is already bounded by the upstream .limit(10) snapshot query;
      # a second cap here would silently drop high-risk sites from the LLM context.
      Site.active.where(flagged_at: nil).where(id: site_ids).map do |s|
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

    # Current ROE posture per site, keyed by site id.
    # Used by the rule engine to factor posture into confidence + rationale.
    def posture_by_site_id
      Site
        .includes(:area_of_operation)
        .where.not(area_of_operation_id: nil)
        .limit(POSTURE_SITE_LIMIT)
        .each_with_object({}) do |site, h|
          ao = site.area_of_operation
          next unless ao
          h[site.id] = { ao_id: ao.id, ao_name: ao.name, posture: ao.posture }
        end
    rescue => e
      Rails.logger.debug "[ContextAssembler] posture_by_site_id error: #{e.message}"
      {}
    end

    # Global asset availability snapshot — used to warn when recommended tasks
    # cannot be staffed and to surface coverage gaps in flag_site rationales.
    def asset_availability
      counts = Asset.group(:status).count
      {
        available: counts["available"].to_i,
        assigned:  counts["assigned"].to_i,
        degraded:  counts["degraded"].to_i,
        offline:   counts["offline"].to_i,
      }
    rescue => e
      Rails.logger.debug "[ContextAssembler] asset_availability error: #{e.message}"
      { available: 0, assigned: 0, degraded: 0, offline: 0 }
    end

    # Available assets (status=available), ordered by name — used by assign_asset rule.
    def available_assets
      Asset.where(status: "available").order(:name).limit(20).map do |a|
        { id: a.id, name: a.name, asset_type: a.asset_type }
      end
    rescue => e
      Rails.logger.debug "[ContextAssembler] available_assets error: #{e.message}"
      []
    end

    # Active high/critical tasks with no asset assigned — prime candidates for assign_asset.
    def unassigned_high_priority_tasks
      Task
        .where(priority: %w[high critical], asset_id: nil)
        .where.not(workflow_status: "resolved")
        .includes(:site)
        .order(Arel.sql("CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 END"), :created_at)
        .limit(10)
        .map { |t| serialize_task(t) }
    rescue => e
      Rails.logger.debug "[ContextAssembler] unassigned_high_priority_tasks error: #{e.message}"
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
