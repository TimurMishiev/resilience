module Api
  class AuditEventsController < BaseController
    include AuditEventScoping

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

      from_time = safe_parse_datetime(params[:from])
      to_time   = safe_parse_datetime(params[:to])
      events = events.where("occurred_at >= ?", from_time) if from_time
      events = events.where("occurred_at <= ?", to_time) if to_time

      event_types = array_param(:event_types)
      events = events.where(event_type: event_types) if event_types.any?

      if access.entity_type.present? && access.entity_id.present?
        # Singular entity_type + entity_id take precedence over entity_types[].
        # The plural entity_types[] filter is only available in the broad (else) path.
        authorize_audit_entity!(access.entity_type, access.entity_id) unless current_user.commander?
        events = events.where(entity_type: access.entity_type, entity_id: access.entity_id)
      else
        events = events.where(entity_type: params[:entity_type]) if params[:entity_type].present?
        events = events.where(entity_id: params[:entity_id]) if params[:entity_id].present?
        entity_types = array_param(:entity_types)
        events = events.where(entity_type: entity_types) if entity_types.any?
        events = scope_audit_events_by_org(events)
      end

      limit = [params.fetch(:limit, 100).to_i, 500].min
      render json: events.limit(limit).map { |e| serialize_event(e) }
    end

    private

    def array_param(key)
      raw = params[key]
      return [] if raw.blank?
      Array(raw).map(&:to_s).reject(&:blank?)
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
