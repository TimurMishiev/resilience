module Correlations
  # Executes a matched rule/site pair asynchronously via Solid::Queue.
  # Enqueued by EvaluatorService for each (rule, signal, site) match so that:
  #   - Rule firing failures don't stall the evaluator loop
  #   - Transient DB errors are retried with exponential backoff
  #   - Job history is visible in the queue for debugging
  class RuleFiringJob < ApplicationJob
    queue_as :correlations

    RuleFiringFailure = Class.new(StandardError)

    # Retry up to 3 times on transient DB/network errors, with exponential backoff.
    # After 3 attempts the job is discarded and the error is logged.
    retry_on ActiveRecord::StatementInvalid, PG::Error,
             wait: :polynomially_longer, attempts: 3

    # If the signal or rule was deleted before the job ran, discard silently.
    discard_on ActiveJob::DeserializationError

    def perform(rule_id, signal_id, site_id)
      result = nil
      rule   = CorrelationRule.find_by(id: rule_id)
      signal = ExternalSignal.find_by(id: signal_id)
      site   = Site.find_by(id: site_id)

      # Records may have been deleted between enqueue and execution — skip gracefully.
      unless rule && signal && site
        log_outcome(:warn, outcome: "missing_records", rule_id: rule_id, signal_id: signal_id, site_id: site_id)
        return
      end

      unless Correlations::EvaluatorService.rule_matches_signal_at_site?(
        rule: rule,
        signal: signal,
        site: site,
        reference_time: signal.occurred_at,
      )
        log_outcome(:info, outcome: "revalidation_skipped", rule_id: rule_id, signal_id: signal_id, site_id: site_id)
        return
      end

      result = Correlations::RuleFiringService.call(rule: rule, signal: signal, site: site)

      unless result.success
        # Cooldown skip is expected — another concurrent job already claimed this
        # firing window. Log at info level and return without raising.
        if result.errors == ["cooldown"]
          log_outcome(:info, outcome: "cooldown_skipped", rule_id: rule_id, signal_id: signal_id, site_id: site_id)
          return
        end

        # All other failures are unexpected — raise so SolidQueue retries.
        raise RuleFiringFailure, result.errors.join(", ")
      end

      log_outcome(
        :info,
        outcome: "fired",
        rule_id: rule_id,
        signal_id: signal_id,
        site_id: site_id,
        result: result,
      )
    rescue StandardError => e
      log_outcome(
        :error,
        outcome: "failed",
        rule_id: rule_id,
        signal_id: signal_id,
        site_id: site_id,
        result: result,
        error: e,
      )

      if e.is_a?(RuleFiringFailure)
        raise "[RuleFiringJob] Rule firing failed: #{e.message}"
      end

      raise
    end

    private

    def log_outcome(level, outcome:, rule_id:, signal_id:, site_id:, result: nil, error: nil)
      parts = [
        "[RuleFiringJob]",
        "outcome=#{outcome}",
        "rule=#{rule_id}",
        "signal=#{signal_id}",
        "site=#{site_id}",
        "attempt=#{executions}",
      ]

      if result&.success
        match = result.payload[:match]
        task = result.payload[:task]
        actions_taken = result.payload[:actions_taken]
        parts << "match=#{match.id}" if match&.id
        parts << "task=#{task.id}" if task&.id
        parts << "actions=#{actions_taken.join(',')}" if actions_taken.present?
      end

      parts << "error_class=#{error.class}" if error
      parts << "error_message=#{error.message.inspect}" if error

      Rails.logger.public_send(level, parts.join(" "))
    end
  end
end
