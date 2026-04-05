module Replay
  # Reconstructs entity attribute snapshots at a given point in time by replaying audit events.
  #
  # For each entity_id, it finds all audit events up to (and including) as_of and returns
  # the after_snapshot from the latest event. Entities with no events before as_of are
  # excluded — they did not exist yet at that point in time.
  #
  # This is a pure read operation with no side effects.
  class ProjectionService < ApplicationService
    # Safety cap: no single projection should need to replay more events than this.
    # Bounded in practice by controller-layer entity_ids, but this prevents a
    # runaway query if the caller is ever misused.
    MAX_EVENTS = 100_000

    def initialize(entity_type:, entity_ids:, as_of:)
      @entity_type = entity_type
      @entity_ids  = Array(entity_ids)
      @as_of       = as_of
    end

    def call
      return ServiceResult.success(snapshots: []) if @entity_ids.empty?

      events = AuditEvent
        .where(entity_type: @entity_type, entity_id: @entity_ids)
        .where("occurred_at <= ?", @as_of)
        .order(:occurred_at)
        .limit(MAX_EVENTS)

      # For each entity, keep the after_snapshot from its latest event up to as_of.
      # entity_ids is always a bounded array from request context (never a full-table
      # scan), so .each is safe and preserves the chronological ORDER BY occurred_at.
      # find_each would discard that ORDER clause and produce non-deterministic snapshots.
      latest = {}
      events.each do |event|
        latest[event.entity_id] = event.after_snapshot
      end

      ServiceResult.success(snapshots: latest.values)
    end
  end
end
