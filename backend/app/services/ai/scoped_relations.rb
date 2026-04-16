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

      if current_user.organization_id.present?
        base.where(organization_id: current_user.organization_id)
      else
        base.none
      end
    end
  end
end
