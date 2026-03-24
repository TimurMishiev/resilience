module Telemetry
  # Drops telemetry partitions older than the configured retention window to
  # keep replay storage bounded. Safe to run repeatedly.
  class PrunePartitionsJob < ApplicationJob
    queue_as :background

    def perform(reference_time = Time.current, retention_days = Telemetry::PartitionManager.default_retention_days)
      Telemetry::PartitionManager.prune_expired!(
        reference_time: reference_time,
        retention_days: retention_days
      )

      Rails.logger.info(
        "[Telemetry::PrunePartitionsJob] pruned telemetry partitions older than #{retention_days} days " \
        "(reference_time=#{reference_time.utc.iso8601})"
      )
    end
  end
end
