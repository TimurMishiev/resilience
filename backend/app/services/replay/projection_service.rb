module Replay
  # Reconstructs entity attribute snapshots at a given point in time by replaying audit events.
  #
  # For each entity_id, it finds all audit events up to (and including) as_of and returns
  # the after_snapshot from the latest event. Entities with no events before as_of are
  # excluded — they did not exist yet at that point in time.
  #
  # This is a pure read operation with no side effects.
  class ProjectionService < ApplicationService
    def initialize(entity_type:, entity_ids:, as_of:)
      @entity_type = entity_type
      @entity_ids  = Array(entity_ids)
      @as_of       = as_of
    end

    def call
      return ServiceResult.success(snapshots: []) if @entity_ids.empty?

      latest_events = AuditEvent
        .select("DISTINCT ON (entity_id) entity_id, after_snapshot")
        .where(entity_type: @entity_type, entity_id: @entity_ids)
        .where("occurred_at <= ?", @as_of)
        .order(Arel.sql("entity_id, occurred_at DESC, id DESC"))

      latest_by_entity_id = latest_events.index_by(&:entity_id)

      ServiceResult.success(
        snapshots: @entity_ids.filter_map { |entity_id| latest_by_entity_id[entity_id]&.after_snapshot }
      )
    end
  end
end
