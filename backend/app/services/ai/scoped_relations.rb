module Ai
  module ScopedRelations
    private

    def current_user
      @user
    end

    def scope_restricted?
      current_user.organization_id.present? || current_user.area_of_operation_id.present?
    end

    def scope_cache_token
      return "global" unless scope_restricted?

      "org:#{current_user.organization_id || '-'}:ao:#{current_user.area_of_operation_id || '-'}"
    end

    def scoped_sites(base = Site.all)
      SitePolicy::Scope.new(current_user, base).resolve
    end

    def scoped_tasks(base = Task.all)
      TaskPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_assets(base = Asset.all)
      AssetPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_areas(base = AreaOfOperation.all)
      AreaOfOperationPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_incidents(base = Incident.all)
      IncidentPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_alerts(base = SignalRuleMatch.all)
      SignalRuleMatchPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_recommendations(base = Recommendation.all)
      RecommendationPolicy::Scope.new(current_user, base).resolve
    end

    def scoped_audit_events(base = AuditEvent.all)
      return base unless scope_restricted?

      visible_site_ids = scoped_sites.select(:id)
      visible_ao_ids = scoped_areas.select(:id)
      visible_task_ids = scoped_tasks.select(:id)
      visible_incident_ids = scoped_incidents.select(:id)
      visible_asset_ids = scoped_assets.select(:id)
      visible_alert_ids = scoped_alerts.select(:id)
      visible_recommendation_ids = scoped_recommendations.select(:id)

      t = AuditEvent.arel_table
      conditions = [
        t[:entity_type].eq("Site").and(t[:entity_id].in(visible_site_ids.arel)),
        t[:entity_type].eq("AreaOfOperation").and(t[:entity_id].in(visible_ao_ids.arel)),
        t[:entity_type].eq("Task").and(t[:entity_id].in(visible_task_ids.arel)),
        t[:entity_type].eq("Incident").and(t[:entity_id].in(visible_incident_ids.arel)),
        t[:entity_type].eq("SignalRuleMatch").and(t[:entity_id].in(visible_alert_ids.arel)),
        t[:entity_type].eq("Asset").and(t[:entity_id].in(visible_asset_ids.arel)),
        t[:entity_type].eq("Recommendation").and(t[:entity_id].in(visible_recommendation_ids.arel)),
        t[:entity_type].eq("CorrelationRule").and(
          t[:entity_id].in(CorrelationRule.where(area_of_operation_id: visible_ao_ids).select(:id).arel)
        ),
        t[:entity_type].eq("Chokepoint").and(
          t[:entity_id].in(Chokepoint.where(area_of_operation_id: visible_ao_ids).select(:id).arel)
        ),
        t[:entity_type].eq("PacePlan").and(
          t[:entity_id].in(PacePlan.where(area_of_operation_id: visible_ao_ids).select(:id).arel)
        ),
        t[:entity_type].eq("CommanderIntent").and(
          t[:entity_id].in(CommanderIntent.where(area_of_operation_id: visible_ao_ids).select(:id).arel)
        ),
        t[:entity_type].eq("SaluteReport").and(
          t[:entity_id].in(SaluteReport.where(area_of_operation_id: visible_ao_ids).select(:id).arel)
        ),
      ]

      if current_user.organization_id.present?
        conditions << t[:entity_type].eq("User").and(
          t[:entity_id].in(User.where(organization_id: current_user.organization_id).select(:id).arel)
        )
        conditions << t[:entity_type].eq("Organization").and(t[:entity_id].eq(current_user.organization_id))
      end

      base.where(conditions.reduce { |combined, condition| combined.or(condition) })
    end
  end
end
