module Recommendations
  class GenerationJob < ApplicationJob
    queue_as :background
    ADVISORY_LOCK_NAMESPACE = 84_602
    ADVISORY_LOCK_KEY = 1

    # Audit P3 (2026-04-29): retry transient DB errors with polynomial
    # backoff instead of letting them become permanent failures. The
    # advisory lock at the top of #perform handles concurrent runs
    # cleanly (next attempt's acquire_lock will return false and
    # gracefully skip if a prior retry's run is still in flight). Three
    # attempts is sufficient for the realistic transient cases (DB
    # connection blip, lock contention, brief PG restart); persistent
    # failures still surface to the dead-letter queue.
    retry_on ActiveRecord::StatementInvalid, ActiveRecord::Deadlocked, PG::Error,
             wait: :polynomially_longer, attempts: 3

    def perform
      unless acquire_lock
        Rails.logger.warn "[GenerationJob] skipped: another generation run is still active"
        record_operational_status(status: "skipped", errors: ["concurrent generation still active"])
        return
      end

      # Enumerate configured tenants. When the deployment has no Organization
      # records (single-tenant / dev), fall back to a single unscoped run —
      # preserves pre-MT2 global behavior. Each tenant generates independently;
      # a failure on one does not block the others. The advisory lock above
      # keeps the whole cycle one-at-a-time.
      org_ids = Organization.pluck(:id)
      tenants = org_ids.empty? ? [nil] : org_ids

      total_created = 0
      total_invalid = 0
      errors = []

      tenants.each do |org_id|
        tag = org_id ? "tenant=#{org_id}" : "tenant=global"
        result = Recommendations::GeneratorService.call(organization_id: org_id)

        if result.success?
          Rails.logger.info "[GenerationJob] #{tag} created=#{result.created} invalid=#{result.invalid_count}"
          total_created += result.created
          total_invalid += result.invalid_count
        else
          Rails.logger.error "[GenerationJob] #{tag} failed: #{result.errors.join(', ')}"
          errors.concat(Array(result.errors).map { |msg| "#{tag}: #{msg}" })
          total_created += result.payload.fetch(:created, 0)
          total_invalid += result.payload.fetch(:invalid_count, 0)
        end
      end

      record_operational_status(
        status: errors.empty? ? "ok" : "error",
        created: total_created,
        invalid_count: total_invalid,
        errors: errors,
      )
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
