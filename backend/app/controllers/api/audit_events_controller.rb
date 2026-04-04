module Api
  class AuditEventsController < BaseController
    ENTITY_ACCESS_MODELS = {
      "AreaOfOperation" => AreaOfOperation,
      "Asset" => Asset,
      "Chokepoint" => Chokepoint,
      "CommanderIntent" => CommanderIntent,
      "CorrelationRule" => CorrelationRule,
      "Incident" => Incident,
      "PacePlan" => PacePlan,
      "Recommendation" => Recommendation,
      "SaluteReport" => SaluteReport,
      "SignalRuleMatch" => SignalRuleMatch,
      "Site" => Site,
      "Task" => Task,
    }.freeze

    def index
      access = AuditEventAccess.new(
        entity_type: params[:entity_type].presence,
        entity_id: params[:entity_id].presence
      )
      authorize access, :index?

      events = AuditEvent.all.order(occurred_at: :desc)
      events = events.up_to(as_of) if as_of.present?
      if access.entity_type.present? && access.entity_id.present?
        authorize_audit_entity!(access.entity_type, access.entity_id) unless current_user.commander?
        events = events.where(entity_type: access.entity_type, entity_id: access.entity_id)
      else
        events = events.where(entity_type: params[:entity_type]) if params[:entity_type].present?
        events = events.where(entity_id: params[:entity_id]) if params[:entity_id].present?
        events = scope_audit_events_by_org(events)
      end

      limit = [params.fetch(:limit, 100).to_i, 500].min
      render json: events.limit(limit).map { |e| serialize_event(e) }
    end

    private

    # Restrict global audit event queries to entities visible within the user's
    # org/AO scope. Uses subqueries to stay in SQL (no pluck + IN-list bloat).
    def scope_audit_events_by_org(events)
      return events unless current_user.organization_id.present? || current_user.area_of_operation_id.present?

      visible_site_ids = policy_scope(Site).select(:id)
      visible_ao_ids   = policy_scope(AreaOfOperation).select(:id)

      t = AuditEvent.arel_table
      conditions = [
        t[:entity_type].eq("Site").and(t[:entity_id].in(visible_site_ids.arel)),
        t[:entity_type].eq("AreaOfOperation").and(t[:entity_id].in(visible_ao_ids.arel)),
        t[:entity_type].eq("Task").and(t[:entity_id].in(Task.where(site_id: visible_site_ids).select(:id).arel)),
        t[:entity_type].eq("Incident").and(t[:entity_id].in(
          Incident.where(site_id: visible_site_ids)
                  .or(Incident.where(area_of_operation_id: visible_ao_ids))
                  .select(:id).arel
        )),
        t[:entity_type].eq("SignalRuleMatch").and(t[:entity_id].in(SignalRuleMatch.where(site_id: visible_site_ids).select(:id).arel)),
        t[:entity_type].eq("CorrelationRule").and(t[:entity_id].in(CorrelationRule.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
        t[:entity_type].eq("Asset").and(t[:entity_id].in(policy_scope(Asset).select(:id).arel)),
        t[:entity_type].eq("Chokepoint").and(t[:entity_id].in(Chokepoint.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
        t[:entity_type].eq("PacePlan").and(t[:entity_id].in(PacePlan.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
        t[:entity_type].eq("CommanderIntent").and(t[:entity_id].in(CommanderIntent.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
        t[:entity_type].eq("SaluteReport").and(t[:entity_id].in(SaluteReport.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
        t[:entity_type].eq("Recommendation").and(t[:entity_id].in(policy_scope(Recommendation).select(:id).arel)),
      ]

      events.where(conditions.reduce { |a, b| a.or(b) })
    end

    def authorize_audit_entity!(entity_type, entity_id)
      model = ENTITY_ACCESS_MODELS[entity_type]
      raise ActiveRecord::RecordNotFound.new("Auditable entity not found", model) unless model

      entity = scoped_record(model, entity_id)
      authorize entity, :show?
    end

    def serialize_event(event)
      event.as_json(only: %i[id schema_version actor entity_type entity_id event_type
                              action before_snapshot after_snapshot metadata
                              correlation_id occurred_at])
    end
  end
end
