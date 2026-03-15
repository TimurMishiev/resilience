module Correlations
  # Background thread that continuously evaluates recently ingested signals
  # against all active correlation rules.
  #
  # Runs every POLL_INTERVAL seconds, processing signals ingested in the
  # most recent window. Follows the same pattern as Telemetry::SimulatorService.
  class BackgroundEvaluator
    POLL_INTERVAL = 10 # seconds

    def self.start
      Thread.new do
        Thread.current.name = "correlation-evaluator"
        Rails.logger.info "[CorrelationEvaluator] started"

        loop do
          begin
            # Grab signals ingested since the last tick (with a small overlap
            # to avoid missing signals that arrive right at the boundary)
            window_start = (POLL_INTERVAL + 2).seconds.ago
            recent = ExternalSignal.where(ingested_at: window_start..Time.current)

            recent.find_each do |signal|
              Correlations::EvaluatorService.call(signal: signal)
            end
          rescue ActiveRecord::StatementInvalid, PG::Error => e
            Rails.logger.error "[CorrelationEvaluator] DB error: #{e.message}"
            sleep 30
            next
          rescue => e
            Rails.logger.error "[CorrelationEvaluator] unexpected error: #{e.message}\n#{e.backtrace&.first(3)&.join("\n")}"
          end

          sleep POLL_INTERVAL
        end
      end
    end
  end
end
