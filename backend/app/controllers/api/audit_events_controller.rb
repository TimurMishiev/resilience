module Api
  class AuditEventsController < BaseController
    skip_after_action :verify_authorized

    def index
      # Entity-scoped queries (entity_id present) are available to all authenticated users —
      # operator-facing detail pages (incidents, sites) need them for inline history panels.
      # The global audit log (no entity_id) exposes actor emails and before/after snapshots
      # across all entities, so it is restricted to commanders.
      return require_commander! unless params[:entity_id].present? || current_user&.role == "commander"

      events = AuditEvent.all.order(occurred_at: :desc)
      events = events.where(entity_type: params[:entity_type]) if params[:entity_type].present?
      events = events.where(entity_id: params[:entity_id]) if params[:entity_id].present?
      limit = [params.fetch(:limit, 100).to_i, 500].min
      render json: events.limit(limit).map { |e| serialize_event(e) }
    end

    private

    def serialize_event(event)
      event.as_json(only: %i[id schema_version actor entity_type entity_id event_type
                              action before_snapshot after_snapshot metadata
                              correlation_id occurred_at])
    end
  end
end
