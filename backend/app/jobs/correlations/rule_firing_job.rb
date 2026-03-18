module Correlations
  # Executes a matched rule/site pair asynchronously via Solid::Queue.
  # Enqueued by EvaluatorService for each (rule, signal, site) match so that:
  #   - Rule firing failures don't stall the evaluator loop
  #   - Transient DB errors are retried with exponential backoff
  #   - Job history is visible in the queue for debugging
  class RuleFiringJob < ApplicationJob
    queue_as :correlations

    # Retry up to 3 times on transient DB/network errors, with exponential backoff.
    # After 3 attempts the job is discarded and the error is logged.
    retry_on ActiveRecord::StatementInvalid, PG::Error,
             wait: :polynomially_longer, attempts: 3

    # If the signal or rule was deleted before the job ran, discard silently.
    discard_on ActiveJob::DeserializationError

    def perform(rule_id, signal_id, site_id)
      rule   = CorrelationRule.find_by(id: rule_id)
      signal = ExternalSignal.find_by(id: signal_id)
      site   = Site.find_by(id: site_id)

      # Records may have been deleted between enqueue and execution — skip gracefully.
      unless rule && signal && site
        Rails.logger.warn "[RuleFiringJob] skipping — rule=#{rule_id} signal=#{signal_id} site=#{site_id}: one or more records not found"
        return
      end

      result = Correlations::RuleFiringService.call(rule: rule, signal: signal, site: site)

      unless result.success
        # Cooldown skip is expected — another concurrent job already claimed this
        # firing window. Log at info level and return without raising.
        if result.errors == ["cooldown"]
          Rails.logger.info "[RuleFiringJob] skipped (cooldown claimed by concurrent job) rule=#{rule_id} site=#{site_id}"
          return
        end

        # All other failures are unexpected — raise so SolidQueue retries.
        error_msg = result.errors.join(", ")
        Rails.logger.error "[RuleFiringJob] FAILED rule_id=#{rule_id} signal_id=#{signal_id} site_id=#{site_id} errors=#{error_msg}"
        raise "[RuleFiringJob] Rule firing failed: #{error_msg}"
      end
    end
  end
end
