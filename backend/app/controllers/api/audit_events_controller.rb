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

      events = AuditEvent.all.order(occurred_at: :desc, id: :desc)
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
        # Skip the entity-level cross-tenant check ONLY for admins — they have
        # genuinely global access. Commanders are documented as tenant-scoped
        # ("operational command authority for one tenant/workspace scope" —
        # User#commander? doc); skipping the check for them silently leaked
        # cross-tenant audit history when the caller knew the entity_id.
        authorize_audit_entity!(access.entity_type, access.entity_id) unless current_user.admin?
        events = events.where(entity_type: access.entity_type, entity_id: access.entity_id)
      else
        events = events.where(entity_type: params[:entity_type]) if params[:entity_type].present?
        events = events.where(entity_id: params[:entity_id]) if params[:entity_id].present?
        entity_types = array_param(:entity_types)
        events = events.where(entity_type: entity_types) if entity_types.any?
        events = scope_audit_events_by_org(events)
      end

      events = apply_before_cursor(events)

      limit = [params.fetch(:limit, 100).to_i, 500].min
      rows = events.limit(limit + 1).to_a
      has_more = rows.length > limit
      rows = rows.first(limit)

      render json: {
        data: rows.map { |event| serialize_event(event) },
        meta: {
          limit: limit,
          has_more: has_more,
          next_cursor: build_next_cursor(rows, has_more: has_more),
        },
      }
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

    def apply_before_cursor(events)
      before_time = safe_parse_datetime(params[:before_occurred_at])
      before_id = params[:before_id].presence
      return events unless before_time

      if before_id.present?
        events.where(
          "occurred_at < :before_time OR (occurred_at = :before_time AND id < :before_id)",
          before_time: before_time,
          before_id: before_id,
        )
      else
        events.where("occurred_at < ?", before_time)
      end
    end

    def build_next_cursor(rows, has_more:)
      return nil unless has_more && rows.any?

      {
        before_occurred_at: rows.last.occurred_at.iso8601(6),
        before_id: rows.last.id,
      }
    end
  end
end
