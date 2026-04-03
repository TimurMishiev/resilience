module Replay
  # Loads the latest audit snapshot per entity as of a historical cutoff.
  # Returns a hash keyed by entity_id so callers can reconstruct replay state
  # without materializing all intervening events repeatedly.
  class AuditSnapshotService < ApplicationService
    MISSING = Object.new.freeze

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
          index[event.entity_id] = self.class.merge_snapshots(index[event.entity_id], event.after_snapshot)
        end

      ServiceResult.success(snapshots: snapshots)
    end

    def self.fetch(snapshot, key, default: MISSING)
      return default unless snapshot.is_a?(Hash)

      normalized_key = key.to_s
      return snapshot[normalized_key] if snapshot.key?(normalized_key)
      return snapshot[key.to_sym] if key.respond_to?(:to_sym) && snapshot.key?(key.to_sym)
      return snapshot[key] if snapshot.key?(key)

      default
    end

    def self.value(snapshot, key, default: MISSING)
      fetch(snapshot, key, default: default)
    end

    def self.merge_snapshots(base_snapshot, delta_snapshot)
      normalized_base = normalize_snapshot(base_snapshot)
      normalized_delta = normalize_snapshot(delta_snapshot)

      normalized_base.merge(normalized_delta) do |_key, base_value, delta_value|
        if base_value.is_a?(Hash) && delta_value.is_a?(Hash)
          merge_snapshots(base_value, delta_value)
        else
          delta_value
        end
      end
    end

    def self.normalize_snapshot(snapshot)
      return {} unless snapshot.is_a?(Hash)

      snapshot.each_with_object({}) do |(key, value), normalized|
        normalized[key.to_s] =
          case value
          when Hash
            normalize_snapshot(value)
          when Array
            value.map { |item| item.is_a?(Hash) ? normalize_snapshot(item) : item }
          else
            value
          end
      end
    end
  end
end
