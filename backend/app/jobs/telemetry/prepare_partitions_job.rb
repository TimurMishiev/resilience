module Telemetry
  # Pre-creates telemetry partitions around the current date so inserts do not
  # have to pay partition DDL cost on the hot path after deploys or midnight
  # rollovers. The write path still fail-safes with ensure_window! if a
  # partition is unexpectedly missing.
  class PreparePartitionsJob < ApplicationJob
    queue_as :background

    DAYS_BACK = 1
    DAYS_AHEAD = Telemetry::PartitionManager::LOOKAHEAD_DAYS

    def perform(reference_time = Time.current)
      Telemetry::PartitionManager.ensure_window!(
        reference_time,
        days_back: DAYS_BACK,
        days_ahead: DAYS_AHEAD
      )

      Rails.logger.info(
        "[Telemetry::PreparePartitionsJob] ensured telemetry partitions around #{reference_time.utc.iso8601} " \
        "(days_back=#{DAYS_BACK}, days_ahead=#{DAYS_AHEAD})"
      )
    end
  end
end
