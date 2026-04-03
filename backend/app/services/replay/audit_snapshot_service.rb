module Replay
  # Loads the latest audit snapshot per entity as of a historical cutoff.
  # Returns a hash keyed by entity_id so callers can reconstruct replay state
  # without materializing all intervening events repeatedly.
  class AuditSnapshotService < ApplicationService
    def initialize(entity_type:, entity_ids:, as_of:)
      @entity_type = entity_type
      @entity_ids = Array(entity_ids).compact.uniq
      @as_of = as_of
    end

    def call
      return ServiceResult.success(snapshots: {}) if @entity_ids.empty? || @as_of.blank?

      snapshots = AuditEvent
        .where(entity_type: @entity_type, entity_id: @entity_ids)
        .where("occurred_at <= ?", @as_of)
        .order(:occurred_at)
        .each_with_object({}) do |event, index|
          index[event.entity_id] = event.after_snapshot || {}
        end

      ServiceResult.success(snapshots: snapshots)
    end

    def self.value(snapshot, key)
      snapshot&.[](key) || snapshot&.[](key.to_s) || snapshot&.[](key.to_sym)
    end
  end
end
