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

      record_operational_status(
        status: "ok",
        reference_time: reference_time,
        window_exhausts_on: (reference_time + DAYS_AHEAD.days).utc.to_date.iso8601,
        error: nil
      )
    rescue => e
      # Re-raise so SolidQueue can retry/discard per its policy, but log at ERROR
      # so the failure is visible in production logs before the retry window expires.
      # If all retries are exhausted, telemetry writes will fail once pre-created
      # partitions run out (~#{DAYS_AHEAD} days from reference_time).
      Rails.logger.error(
        "[Telemetry::PreparePartitionsJob] CRITICAL: partition preparation failed — " \
        "#{e.class}: #{e.message}. Telemetry writes may fail after " \
        "#{(reference_time + DAYS_AHEAD.days).utc.to_date}."
      )
      record_operational_status(
        status: "error",
        reference_time: reference_time,
        window_exhausts_on: (reference_time + DAYS_AHEAD.days).utc.to_date.iso8601,
        error: e
      )
      raise
    end

    private

    def record_operational_status(status:, reference_time:, window_exhausts_on:, error:)
      payload = {
        status: status,
        checked_at: Time.current.iso8601(3),
        reference_time: reference_time.utc.iso8601,
        days_back: DAYS_BACK,
        days_ahead: DAYS_AHEAD,
        window_exhausts_on: window_exhausts_on,
      }
      if error
        payload[:last_error_class] = error.class.name
        payload[:last_error_message] = error.message
      end

      OperationalStatus.record!(
        category: "job_health",
        key: "telemetry_partitions",
        payload: payload
      )
    end
  end
end
