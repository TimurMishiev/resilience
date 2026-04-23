module Recommendations
  # Assembles a structured snapshot of the current operational state for use
  # by the rule engine and LLM enricher. All queries are read-only and kept
  # tight to avoid bloating the LLM prompt with irrelevant data.
  #
  # Tenant scoping: pass `organization_id:` to restrict every read to entities
  # owned by a single tenant (via site.organization_id, AO.organization_id, or
  # home_site.organization_id as appropriate). Pass nil — the default — to
  # preserve pre-MT2 global-read behavior; this is what single-org deployments
  # hit via GenerationJob's empty-organization fallback.
  class ContextAssembler < ApplicationService
    STALE_ALERT_HOURS       = 4    # unacknowledged alert older than this = stale
    HIGH_CONF_THRESHOLD     = 0.70
    BULK_TRIAGE_THRESHOLD   = 5    # ≥5 unacknowledged alerts at one site → bulk suggest
    # Caps the number of sites loaded into the LLM context window for posture
    # enrichment. Keep this tight — the LLM prompt budget is finite and posture
    # data beyond ~500 sites produces no useful signal at the resolution the
    # rule engine operates at.
    POSTURE_SITE_LIMIT      = 500

    def self.call(organization_id: nil)
      new(organization_id: organization_id).call
    end

    def initialize(organization_id: nil)
      @organization_id = organization_id
    end

    def call
      ServiceResult.success(context: build_context)
    rescue ActiveRecord::ActiveRecordError => e
      Rails.logger.error "[ContextAssembler] #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    attr_reader :organization_id

    # Scope a relation whose belongs_to :site carries the tenant anchor
    # (SignalRuleMatch, Task). In per-tenant mode, siteless records are
    # excluded — they cannot be safely attributed to any organization.
    def tenant_via_site(relation)
      return relation if organization_id.nil?
      relation.joins(:site).where(sites: { organization_id: organization_id })
    end

    # Scope Incident: site.organization_id when site is present; fall back
    # to AO.organization_id when the incident has no site. Incidents with
    # neither a site nor an AO are excluded in per-tenant mode.
    def tenant_incidents(relation)
      return relation if organization_id.nil?
      relation
        .left_joins(:site, :area_of_operation)
        .where(
          "sites.organization_id = :org_id OR " \
          "(incidents.site_id IS NULL AND areas_of_operation.organization_id = :org_id)",
          org_id: organization_id,
        )
    end

    # Scope Site directly.
    def tenant_sites(relation)
      return relation if organization_id.nil?
      relation.where(organization_id: organization_id)
    end

    # Scope Asset via home_site.organization_id (matches MT1's AssetPolicy::Scope).
    # Assets with nil home_site are excluded in per-tenant mode — same as the
    # AssetPolicy::Scope behavior for restricted users.
    def tenant_assets(relation)
      return relation if organization_id.nil?
      relation.joins(:home_site).where(sites: { organization_id: organization_id })
    end

    # Scope SiteRiskSnapshot via site.organization_id.
    def tenant_snapshots(relation)
      return relation if organization_id.nil?
      relation.joins(:site).where(sites: { organization_id: organization_id })
    end

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
      tenant_via_site(
        SignalRuleMatch
          .unacknowledged
          .where("fired_at < ?", STALE_ALERT_HOURS.hours.ago),
      )
        .includes(:site, :correlation_rule, :signal)
        .order(fired_at: :asc)
        .limit(20)
        .map { |m| serialize_match(m) }
    end

    # High-confidence unacknowledged alerts (≥70%) — prime escalation candidates
    def high_conf_unacked_alerts
      tenant_via_site(
        SignalRuleMatch
          .unacknowledged
          .high_confidence
          .where("fired_at > ?", 24.hours.ago),
      )
        .includes(:site, :correlation_rule, :signal)
        .order(confidence: :desc)
        .limit(10)
        .map { |m| serialize_match(m) }
    end

    # Active incidents (open + acknowledged), ordered critical-first
    def open_incidents
      tenant_incidents(Incident.active)
        .by_severity
        .includes(:site, :signal_rule_matches)
        .limit(10)
        .map { |i| serialize_incident(i) }
    end

    # Tasks blocked or in-progress for > 48 hours
    def overdue_tasks
      tenant_via_site(
        Task
          .where(workflow_status: %w[blocked in_progress])
          .where("tasks.updated_at < ?", 48.hours.ago),
      )
        .includes(:site)
        .limit(10)
        .map { |t| serialize_task(t) }
    end

    # Sites with high risk score (from latest snapshot) but not yet flagged
    def flaggable_sites
      # Pull recent high-score snapshots then resolve sites
      # score column is integer 0-100
      recent_high = tenant_snapshots(
        SiteRiskSnapshot
          .where("score >= ?", 75)
          .where("recorded_at > ?", 24.hours.ago),
      )
        .order(score: :desc)
        .limit(10)

      site_ids = recent_high.pluck(:site_id).uniq
      return [] if site_ids.empty?

      scores = recent_high.each_with_object({}) { |r, h| h[r.site_id] ||= r.score }

      # site_ids is already tenant-scoped (via tenant_snapshots above) and
      # bounded by the upstream .limit(10); tenant_sites is a no-op in global
      # mode and a redundant-but-harmless filter in per-tenant mode.
      tenant_sites(Site.active).where(flagged_at: nil).where(id: site_ids).map do |s|
        { id: s.id, name: s.name, risk_score: (scores[s.id].to_f / 100.0) }
      end
    rescue => e
      Rails.logger.warn "[ContextAssembler] flaggable_sites error: #{e.class}: #{e.message}"
      []
    end

    # Sites where many unacknowledged alerts are piling up
    def bulk_triage_sites
      tenant_via_site(
        SignalRuleMatch
          .unacknowledged
          .where("fired_at > ?", 24.hours.ago)
          .where.not(site_id: nil),
      )
        .group(:site_id)
        .having("COUNT(*) >= ?", BULK_TRIAGE_THRESHOLD)
        .count
        .map { |site_id, count| { site_id: site_id, unacked_count: count } }
    end

    # Latest risk snapshots (per-site most-recent)
    def risk_snapshots
      tenant_snapshots(SiteRiskSnapshot.all)
        .order(recorded_at: :desc)
        .limit(5)
        .map { |r| { site_id: r.site_id, score: r.score, recorded_at: r.recorded_at.iso8601 } }
    rescue => e
      Rails.logger.warn "[ContextAssembler] risk_snapshots error: #{e.class}: #{e.message}"
      []
    end

    # Current ROE posture per site, keyed by site id.
    # Used by the rule engine to factor posture into confidence + rationale.
    def posture_by_site_id
      tenant_sites(Site.all)
        .includes(:area_of_operation)
        .where.not(area_of_operation_id: nil)
        .limit(POSTURE_SITE_LIMIT)
        .each_with_object({}) do |site, h|
          ao = site.area_of_operation
          next unless ao
          h[site.id] = { ao_id: ao.id, ao_name: ao.name, posture: ao.posture }
        end
    rescue => e
      Rails.logger.warn "[ContextAssembler] posture_by_site_id error: #{e.class}: #{e.message}"
      {}
    end

    # Asset availability snapshot — used to warn when recommended tasks
    # cannot be staffed and to surface coverage gaps in flag_site rationales.
    # Scoped to the current tenant when organization_id is set.
    def asset_availability
      counts = tenant_assets(Asset.all).group("assets.status").count
      {
        available: counts["available"].to_i,
        assigned:  counts["assigned"].to_i,
        degraded:  counts["degraded"].to_i,
        offline:   counts["offline"].to_i,
      }
    rescue => e
      Rails.logger.warn "[ContextAssembler] asset_availability error: #{e.class}: #{e.message}"
      { available: 0, assigned: 0, degraded: 0, offline: 0 }
    end

    # Available assets (status=available), ordered by name — used by assign_asset rule.
    def available_assets
      tenant_assets(Asset.where(status: "available"))
        .order("assets.name")
        .limit(20)
        .map { |a| { id: a.id, name: a.name, asset_type: a.asset_type } }
    rescue => e
      Rails.logger.warn "[ContextAssembler] available_assets error: #{e.class}: #{e.message}"
      []
    end

    # Active high/critical tasks with no asset assigned — prime candidates for assign_asset.
    def unassigned_high_priority_tasks
      tenant_via_site(
        Task
          .where(priority: %w[high critical], asset_id: nil)
          .where.not(workflow_status: "resolved"),
      )
        .includes(:site)
        .order(Arel.sql("CASE tasks.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 END"), "tasks.created_at")
        .limit(10)
        .map { |t| serialize_task(t) }
    rescue => e
      Rails.logger.warn "[ContextAssembler] unassigned_high_priority_tasks error: #{e.class}: #{e.message}"
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
