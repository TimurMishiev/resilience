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
    # tick without chunking. Note: changed from `find_each` (1k batches)
    # to `.limit(MAX).to_a` (full materialisation) when the cursor was
    # introduced because the cursor advance needs the last processed
    # signal in hand. Memory at MAX=2_000 with the SELECT projection
    # below is ~1 MB — fine. If MAX is ever raised significantly,
    # revisit and reintroduce batched iteration with a per-batch
    # cursor advance.
    MAX_SIGNALS_PER_TICK = 2_000

    # Name identifying this consumer's cursor in the ingestion_cursors table.
    CURSOR_NAME = "correlations.evaluate_recent".freeze

    retry_on StandardError, wait: :polynomially_longer, attempts: 3

    def perform
      cursor = IngestionCursor.for(CURSOR_NAME)

      # Partial selects on these queries pre-empt loading every column of
      # every signal/site through the correlation hot path. The selects
      # MUST include every column read by downstream consumers
      # (EvaluatorService, RuleFiringService, GeofenceBreachService, and
      # — transitively via SignalRuleMatch.create!(site: ...) — the
      # FusionService that reads `match.site.<column>` from the cached
      # AR association). Audit 2026-05-01 caught two real defects from
      # under-selected columns:
      #   - signal `magnitude` (read by EvaluatorService#magnitude_ok?
      #     for any rule with magnitude_min — production has 5 such rules
      #     in db/seeds.rb)
      #   - site `area_of_operation_id` (read by FusionService when
      #     opening incidents from geofence breaches)
      # Both raised MissingAttributeError that was silently swallowed
      # by callers' rescue blocks → incidents and rule firings never
      # happened. If you add a column read in the downstream services,
      # add it here too OR add a regression spec that traces the call
      # chain end-to-end with a partial-select fixture.
      recent = cursor
        .signals_since(ExternalSignal.select(:id, :source, :signal_type, :external_id,
                                             :lat, :lng, :magnitude, :occurred_at, :ingested_at))
        .limit(MAX_SIGNALS_PER_TICK)
        .to_a

      return if recent.empty?

      active_sites = Site.active
        .where("geofence_radius_km > 0")
        .select(:id, :name, :latitude, :longitude, :geofence_radius_km, :area_of_operation_id)
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
