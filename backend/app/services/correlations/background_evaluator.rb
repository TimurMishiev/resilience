module Correlations
  # Background thread that continuously evaluates recently ingested signals
  # against all active correlation rules.
  #
  # Runs every POLL_INTERVAL seconds, processing signals ingested in the
  # most recent window. Matching rule/site pairs are enqueued as
  # Correlations::RuleFiringJob via Solid::Queue — evaluation is decoupled
  # from firing, which gets proper retry semantics.
  class BackgroundEvaluator
    POLL_INTERVAL          = 10   # seconds between evaluation ticks
    MAX_CONSECUTIVE_ERRORS = 10
    DEAD_SLEEP_SECONDS     = 300  # pause after MAX_CONSECUTIVE_ERRORS

    def self.start
      Thread.new do
        Rails.application.executor.wrap do
          Thread.current.name  = "correlation-evaluator"
          consecutive_errors   = 0
          backoff              = 5

          Rails.logger.info "[CorrelationEvaluator] started — polling every #{POLL_INTERVAL}s"

          loop do
            begin
              ActiveRecord::Base.connected_to(role: :writing) do
                ActiveRecord::Base.connection_pool.with_connection do
                  window_start = (POLL_INTERVAL + 2).seconds.ago
                  recent = ExternalSignal.where(ingested_at: window_start..Time.current)

                  recent.find_each do |signal|
                    Correlations::EvaluatorService.call(signal: signal)
                    Sites::GeofenceBreachService.call(signal: signal)
                  end
                end
              end

              consecutive_errors = 0
              backoff            = 5
              sleep POLL_INTERVAL

            rescue ActiveRecord::StatementInvalid, PG::Error => e
              consecutive_errors += 1
              wait = [backoff, 300].min
              Rails.logger.error "[CorrelationEvaluator] DB error (attempt #{consecutive_errors}): #{e.message} — retrying in #{wait}s"
              backoff = [backoff * 2, 300].min

              if consecutive_errors >= MAX_CONSECUTIVE_ERRORS
                Rails.logger.error "[CorrelationEvaluator] CRITICAL: #{MAX_CONSECUTIVE_ERRORS} consecutive DB errors — pausing #{DEAD_SLEEP_SECONDS}s"
                Observability.capture_exception(
                  e,
                  tags: { component: "correlation_evaluator", error_class: "db_error" },
                  extra: { consecutive_errors: consecutive_errors },
                  fingerprint: ["correlation_evaluator", "db_error", e.class.name],
                  throttle_key: "correlation_evaluator:db_error:#{e.class}",
                  throttle_seconds: DEAD_SLEEP_SECONDS
                )
                sleep DEAD_SLEEP_SECONDS
                consecutive_errors = 0
                backoff            = 5
              else
                sleep wait
              end

            rescue => e
              consecutive_errors += 1
              wait = [backoff, 300].min
              Rails.logger.error "[CorrelationEvaluator] unexpected error (attempt #{consecutive_errors}): #{e.class}: #{e.message} — retrying in #{wait}s"
              backoff = [backoff * 2, 300].min

              if consecutive_errors >= MAX_CONSECUTIVE_ERRORS
                Rails.logger.error "[CorrelationEvaluator] CRITICAL: #{MAX_CONSECUTIVE_ERRORS} consecutive errors — pausing #{DEAD_SLEEP_SECONDS}s"
                Observability.capture_exception(
                  e,
                  tags: { component: "correlation_evaluator", error_class: "unexpected_error" },
                  extra: { consecutive_errors: consecutive_errors },
                  fingerprint: ["correlation_evaluator", "unexpected_error", e.class.name],
                  throttle_key: "correlation_evaluator:unexpected_error:#{e.class}",
                  throttle_seconds: DEAD_SLEEP_SECONDS
                )
                sleep DEAD_SLEEP_SECONDS
                consecutive_errors = 0
                backoff            = 5
              else
                sleep wait
              end
            end
          end
        end
      rescue StandardError => e
        Rails.logger.error "[CorrelationEvaluator] thread died: #{e.class}: #{e.message}"
        Observability.capture_exception(
          e,
          tags: { component: "correlation_evaluator", lifecycle: "thread_exit" },
          throttle_key: "correlation_evaluator:thread_exit:#{e.class}",
          throttle_seconds: 300
        )
        raise
      end
    end
  end
end
