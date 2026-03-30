module Recommendations
  class GenerationJob < ApplicationJob
    queue_as :background
    ADVISORY_LOCK_NAMESPACE = 84_602
    ADVISORY_LOCK_KEY = 1

    def perform
      unless acquire_lock
        Rails.logger.warn "[GenerationJob] skipped: another generation run is still active"
        record_operational_status(status: "skipped", errors: ["concurrent generation still active"])
        return
      end

      result = Recommendations::GeneratorService.call
      if result.success?
        Rails.logger.info "[GenerationJob] created=#{result.created} invalid=#{result.invalid_count}"
        record_operational_status(
          status: "ok",
          created: result.created,
          invalid_count: result.invalid_count,
          errors: []
        )
      else
        Rails.logger.error "[GenerationJob] failed: #{result.errors.join(', ')}"
        record_operational_status(
          status: "error",
          created: result.payload.fetch(:created, 0),
          invalid_count: result.payload.fetch(:invalid_count, 0),
          errors: result.errors
        )
      end
    rescue => e
      Rails.logger.error "[GenerationJob] crashed: #{e.class}: #{e.message}"
      record_operational_status(status: "error", errors: ["#{e.class}: #{e.message}"])
      raise
    ensure
      release_lock
    end

    private

    def acquire_lock
      @lock_acquired = ActiveRecord::Base.connection.select_value(
        ApplicationRecord.send(
          :sanitize_sql_array,
          ["SELECT pg_try_advisory_lock(?, ?)", ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY]
        )
      )
      @lock_acquired == true || @lock_acquired == "t"
    end

    def release_lock
      return unless @lock_acquired

      ActiveRecord::Base.connection.select_value(
        ApplicationRecord.send(
          :sanitize_sql_array,
          ["SELECT pg_advisory_unlock(?, ?)", ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY]
        )
      )
      @lock_acquired = false
    end

    def record_operational_status(status:, created: 0, invalid_count: 0, errors: [])
      OperationalStatus.record!(
        category: "job_health",
        key: "recommendation_generation",
        payload: {
          status: status,
          checked_at: Time.current.iso8601(3),
          created: created,
          invalid_count: invalid_count,
          error_messages: Array(errors).map(&:to_s).reject(&:blank?).first(3),
        }.compact
      )
    end
  end
end
