module Correlations
  # Evaluates recently ingested signals against all active correlation rules
  # and checks for geofence breaches.
  #
  # Scheduling: configured as a Solid Queue recurring task in
  # config/recurring.yml (every 30 seconds).
  #
  # Uses an IngestionCursor high-water mark instead of a wall-clock
  # window. If SolidQueue falls behind (deploy, load spike, GC pause),
  # the next tick picks up exactly where the last successful run stopped
  # — no signal is dropped between ticks regardless of latency.
  class EvaluateRecentJob < ApplicationJob
    queue_as :background

    # Upper bound on signals processed per tick. Prevents a long backlog
    # from starving the DB — the next tick picks up the rest. Sized
    # generously vs. typical ingest rates so routine bursts clear in one
    # tick without chunking.
    MAX_SIGNALS_PER_TICK = 2_000

    # Name identifying this consumer's cursor in the ingestion_cursors table.
    CURSOR_NAME = "correlations.evaluate_recent".freeze

    retry_on StandardError, wait: :polynomially_longer, attempts: 3

    def perform
      cursor = IngestionCursor.for(CURSOR_NAME)

      recent = cursor
        .signals_since(ExternalSignal.select(:id, :source, :signal_type, :external_id,
                                             :lat, :lng, :occurred_at, :ingested_at))
        .limit(MAX_SIGNALS_PER_TICK)
        .to_a

      return if recent.empty?

      active_sites = Site.active
        .where("geofence_radius_km > 0")
        .select(:id, :name, :latitude, :longitude, :geofence_radius_km)
        .to_a

      count = 0
      last_processed = nil
      recent.each do |signal|
        Correlations::EvaluatorService.call(signal: signal)
        Sites::GeofenceBreachService.call(signal: signal, sites: active_sites)
        last_processed = signal
        count += 1
      end

      # Advance only after the batch completes. If any signal raises,
      # retry_on picks up and the cursor stays at the previous value —
      # the failed signal plus everything after is reprocessed on the
      # next attempt. Downstream services (RuleFiringService,
      # FusionService) are idempotent via SignalRuleMatch unique
      # constraints, so reprocessing does not create duplicate fires.
      cursor.advance_to(last_processed)

      Rails.logger.info(
        "[Correlations::EvaluateRecentJob] evaluated=#{count} " \
        "cursor_ingested_at=#{cursor.last_ingested_at.iso8601(3)} " \
        "cursor_signal_id=#{cursor.last_signal_id}"
      )
    end
  end
end
