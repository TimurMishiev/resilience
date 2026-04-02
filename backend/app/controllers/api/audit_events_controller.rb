module Api
  class AuditEventsController < BaseController
    ENTITY_ACCESS_MODELS = {
      "AreaOfOperation" => AreaOfOperation,
      "Asset" => Asset,
      "Chokepoint" => Chokepoint,
      "CorrelationRule" => CorrelationRule,
      "Incident" => Incident,
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
      end

      limit = [params.fetch(:limit, 100).to_i, 500].min
      render json: events.limit(limit).map { |e| serialize_event(e) }
    end

    private

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
