module Recommendations
  # Tier 1: Deterministic, rule-based recommendation generation.
  # Produces zero-LLM recommendations that are always fast, cheap, and explainable.
  # Each rule returns an array of recommendation attribute hashes (or []).
  class RuleEngine < ApplicationService
    def initialize(context:)
      @ctx = context
    end

    def call
      recs = []
      recs.concat close_stale_alerts
      recs.concat acknowledge_high_conf_alerts
      recs.concat escalate_incidents
      recs.concat bulk_triage_suggestions
      recs.concat flag_high_risk_sites
      recs.concat suggest_asset_assignments
      ServiceResult.success(recommendations: recs)
    end

    private

    # ── Rule: close_stale_alert ─────────────────────────────────────────────────
    # Unacknowledged low-confidence alerts older than 4 hours → suggest close
    def close_stale_alerts
      @ctx[:stale_alerts]
        .select { |a| a[:confidence] < 0.5 }
        .reject { |a| already_pending?("close_stale_alert", "SignalRuleMatch", a[:id]) }
        .map do |a|
          hours_old = ((Time.current - Time.parse(a[:fired_at])) / 3600).round(1)
          build_rec(
            type:        "close_stale_alert",
            tier:        "rule",
            confidence:  0.85,
            rationale:   "Alert '#{a[:rule_name] || a[:signal_type]}' at #{a[:site_name] || 'unknown site'} " \
                         "has been unacknowledged for #{hours_old}h with low confidence (#{(a[:confidence] * 100).round}%). " \
                         "Recommend closing to reduce noise.",
            evidence:    [{ type: "alert", id: a[:id], detail: "fired_at=#{a[:fired_at]}, conf=#{a[:confidence]}" }],
            payload:     { alert_id: a[:id], to_status: "closed" },
            entity_type: "SignalRuleMatch",
            entity_id:   a[:id],
          )
        end
    end

    # ── Rule: acknowledge_alert ─────────────────────────────────────────────────
    # High-confidence unacknowledged alerts → suggest acknowledge
    def acknowledge_high_conf_alerts
      @ctx[:high_conf_alerts]
        .reject { |a| already_pending?("acknowledge_alert", "SignalRuleMatch", a[:id]) }
        .map do |a|
          build_rec(
            type:        "acknowledge_alert",
            tier:        "rule",
            confidence:  [a[:confidence].to_f, 0.90].min,
            rationale:   "High-confidence alert (#{(a[:confidence] * 100).round}%) from " \
                         "'#{a[:rule_name] || a[:signal_type]}' at #{a[:site_name] || 'unknown'} " \
                         "requires attention. Recommend acknowledging to begin triage.",
            evidence:    [{ type: "alert", id: a[:id], detail: "conf=#{a[:confidence]}, fired=#{a[:fired_at]}" }],
            payload:     { alert_id: a[:id], to_status: "acknowledged" },
            entity_type: "SignalRuleMatch",
            entity_id:   a[:id],
          )
        end
    end

    # ── Rule: escalate_incident ─────────────────────────────────────────────────
    # Open incidents (not yet acknowledged) with high severity or many alerts → escalate.
    # Confidence is adjusted downward when the site AO is in Observe posture —
    # Observe = eyes only, active response not yet authorised by ROE.
    def escalate_incidents
      posture_map = @ctx.fetch(:posture_by_site_id, {})

      @ctx[:open_incidents]
        .select { |i| i[:status] == "open" && %w[high critical].include?(i[:severity]) }
        .reject { |i| already_pending?("escalate_incident", "Incident", i[:id]) }
        .map do |i|
          posture_info = posture_map[i[:site_id]]
          posture      = posture_info&.[](:posture)

          # Downgrade confidence for Observe AOs — awareness recommended but
          # ROE does not yet authorise active escalation response.
          base_conf  = i[:confidence].to_f
          confidence = posture == "observe" ? (base_conf * 0.7).round(4) : base_conf

          posture_note =
            case posture
            when "observe"
              " ROE posture: Observe (#{posture_info[:ao_name]}) — awareness recommended; " \
              "active response not yet authorised."
            when "defensive"
              " ROE posture: Defensive (#{posture_info[:ao_name]}) — defensive actions authorised."
            when "weapons_free"
              " ROE posture: Weapons Free (#{posture_info[:ao_name]}) — immediate action authorised."
            end

          build_rec(
            type:        "escalate_incident",
            tier:        "rule",
            confidence:  confidence,
            rationale:   "#{i[:severity].capitalize} incident '#{i[:title]}' has been open since " \
                         "#{Time.parse(i[:opened_at]).strftime('%b %-d %H:%M')} with #{i[:alert_count]} " \
                         "alert(s). Recommend acknowledging and beginning containment." \
                         "#{posture_note}",
            evidence:    [{ type: "incident", id: i[:id], detail: "severity=#{i[:severity]}, alerts=#{i[:alert_count]}" }],
            payload:     { incident_id: i[:id], to_status: "acknowledged" },
            entity_type: "Incident",
            entity_id:   i[:id],
          )
        end
    end

    # ── Rule: bulk_triage_alerts ────────────────────────────────────────────────
    # Sites with ≥5 unacked alerts piling up → recommend bulk triage
    def bulk_triage_suggestions
      @ctx[:bulk_triage_sites]
        .reject { |s| already_pending?("bulk_triage_alerts", "Site", s[:site_id]) }
        .map do |s|
          build_rec(
            type:        "bulk_triage_alerts",
            tier:        "rule",
            confidence:  0.80,
            rationale:   "#{s[:unacked_count]} unacknowledged alerts are queued at this site. " \
                         "Bulk triage can resolve noise and surface actionable items faster.",
            evidence:    [{ type: "site", id: s[:site_id], detail: "unacked_count=#{s[:unacked_count]}" }],
            payload:     { site_id: s[:site_id], unacked_count: s[:unacked_count] },
            entity_type: "Site",
            entity_id:   s[:site_id],
          )
        end
    end

    # ── Rule: flag_site ─────────────────────────────────────────────────────────
    # Sites with high risk score not yet flagged.
    # Confidence is boosted slightly when the fleet has no actionable assets —
    # a high-risk site with zero coverage is more urgent than one with coverage.
    def flag_high_risk_sites
      assets     = @ctx.fetch(:asset_availability, { available: 0, assigned: 0 })
      actionable = assets[:available].to_i + assets[:assigned].to_i

      @ctx[:flaggable_sites]
        .reject { |s| already_pending?("flag_site", "Site", s[:id]) }
        .map do |s|
          base_conf  = [s[:risk_score].to_f, 0.95].min
          # No available/assigned assets → site is exposed and uncovered → boost urgency
          confidence = actionable.zero? ? [base_conf + 0.05, 0.95].min : base_conf

          coverage_note =
            if actionable.zero?
              " No operational assets are currently available or assigned — site has no coverage."
            elsif assets[:available].to_i > 0
              " #{assets[:available]} asset(s) currently available for tasking."
            end

          build_rec(
            type:        "flag_site",
            tier:        "rule",
            confidence:  confidence,
            rationale:   "#{s[:name]} has a risk score of #{(s[:risk_score] * 100).round}% but is not yet flagged. " \
                         "Flagging will prioritise it in operational views and trigger additional monitoring." \
                         "#{coverage_note}",
            evidence:    [{ type: "site", id: s[:id], detail: "risk_score=#{s[:risk_score]}" }],
            payload:     { site_id: s[:id] },
            entity_type: "Site",
            entity_id:   s[:id],
          )
        end
    end

    # ── Rule: assign_asset ──────────────────────────────────────────────────────
    # Unassigned high/critical tasks with available assets in the fleet → suggest assignment.
    # Skipped when the task's AO is in Observe posture (ROE forbids assignment).
    def suggest_asset_assignments
      # Dup so we can shift candidates off the front without mutating context
      candidates  = @ctx.fetch(:available_assets, []).dup
      return [] if candidates.empty?

      posture_map = @ctx.fetch(:posture_by_site_id, {})
      recs        = []

      @ctx.fetch(:unassigned_high_priority_tasks, [])
        .reject { |t| already_pending?("assign_asset", "Task", t[:id]) }
        .reject { |t| posture_map.dig(t[:site_id], :posture) == "observe" }
        .each do |t|
          break if candidates.empty?  # no more assets to allocate this pass

          asset        = candidates.shift  # consume candidate — prevents same asset appearing twice
          posture_info = posture_map[t[:site_id]]
          posture_note =
            case posture_info&.[](:posture)
            when "defensive"    then " AO posture is Defensive — available assets only."
            when "weapons_free" then " AO posture is Weapons Free — all assets eligible."
            end

          recs << build_rec(
            type:        "assign_asset",
            tier:        "rule",
            confidence:  t[:priority] == "critical" ? 0.88 : 0.75,
            rationale:   "#{t[:priority].capitalize} task '#{t[:title]}' at #{t[:site_name] || 'unknown site'} " \
                         "has no assigned asset. Recommend assigning #{asset[:name]} (#{asset[:asset_type]})." \
                         "#{posture_note}",
            evidence:    [
              { type: "task",  id: t[:id],     detail: "priority=#{t[:priority]}, status=#{t[:workflow_status]}" },
              { type: "asset", id: asset[:id], detail: "status=available" },
            ],
            payload:     { task_id: t[:id], asset_id: asset[:id] },
            entity_type: "Task",
            entity_id:   t[:id],
          )
        end

      recs
    end

    # ── Helpers ──────────────────────────────────────────────────────────────────

    def build_rec(type:, tier:, confidence:, rationale:, evidence:, payload:, entity_type:, entity_id:)
      {
        recommendation_type:  type,
        tier:                 tier,
        confidence:           confidence.round(4),
        rationale:            rationale,
        evidence:             evidence,
        action_payload:       payload,
        affected_entity_type: entity_type,
        affected_entity_id:   entity_id,
        expires_at:           Recommendation::EXPIRY_BY_TIER[tier].from_now,
        status:               "pending",
      }
    end

    def already_pending?(type, entity_type, entity_id)
      Recommendation.duplicate_pending?(type: type, entity_type: entity_type, entity_id: entity_id)
    end
  end
end
