# Starts all live-feed ingestion background threads after Rails has fully booted.
# Each feed polls a public data source and ingests ExternalSignal records via
# Signals::IngestService (idempotent — unique index prevents duplicate ingestion).
#
# Skipped in test mode, rake tasks, and Rails console.
#
# Feed summary:
#   opensky-feed   — aircraft positions (OpenSky Network, no key)          — 900s
#   usgs-feed      — seismic events     (USGS FDSN, no key)                — 300s
#   gpsjam-feed    — GPS interference   (gpsjam.org, no key)               — 900s
#   ais-feed       — vessel positions   (AIS Hub, AISHUB_USERNAME)         — 30s
#   firms-feed     — wildfire hotspots  (NASA FIRMS, NASA_FIRMS_MAP_KEY)   — 900s
#   acled-feed     — conflict events    (ACLED, ACLED_API_KEY + ACLED_EMAIL) — 3600s
#   gdacs-feed     — disaster alerts    (GDACS UN, no key)                   — 900s
#
# AIS, FIRMS, and ACLED feeds require API keys; threads are skipped if keys are absent.
# GDACS is fully public — no credentials needed.
# See backend/.env.example for all required variables.
#
# Retry policy: exponential backoff on errors — 5s → 10s → 20s → … → cap 300s.
# After MAX_CONSECUTIVE_ERRORS failures in a row the thread logs a critical alert
# and sleeps for DEAD_SLEEP_SECONDS before trying again (rather than spinning).
unless Rails.env.test? || defined?(Rails::Console) || File.basename($PROGRAM_NAME) == "rake"
  Rails.application.config.after_initialize do

    # ---------------------------------------------------------------------------
    # Shared retry helper — yields to the caller's poll block, handles errors
    # with exponential backoff, and resets the backoff counter on success.
    #
    # tag             — log prefix, e.g. "[OpenSkyFeed]"
    # poll_interval   — normal sleep between successful polls (seconds)
    # ---------------------------------------------------------------------------
    MAX_CONSECUTIVE_ERRORS = 10
    DEAD_SLEEP_SECONDS     = 600  # 10 min pause after MAX_CONSECUTIVE_ERRORS

    feed_loop = lambda do |tag, poll_interval, &block|
      consecutive_errors = 0
      backoff            = 5  # initial backoff seconds

      loop do
        begin
          result = block.call

          if result.success
            count = result.payload[:ingested]
            Rails.logger.info "#{tag} ingested #{count} new records" if count.to_i > 0
          else
            Rails.logger.warn "#{tag} errors: #{result.errors.join(', ')}"
          end

          # Success — reset backoff
          consecutive_errors = 0
          backoff            = 5
          sleep poll_interval

        rescue ActiveRecord::StatementInvalid, PG::Error => e
          consecutive_errors += 1
          wait = [backoff, 300].min
          Rails.logger.error "#{tag} DB error (attempt #{consecutive_errors}): #{e.message} — retrying in #{wait}s"
          backoff = [backoff * 2, 300].min

          if consecutive_errors >= MAX_CONSECUTIVE_ERRORS
            Rails.logger.error "#{tag} CRITICAL: #{MAX_CONSECUTIVE_ERRORS} consecutive DB errors — pausing #{DEAD_SLEEP_SECONDS}s"
            sleep DEAD_SLEEP_SECONDS
            consecutive_errors = 0
            backoff            = 5
          else
            sleep wait
          end

        rescue => e
          consecutive_errors += 1
          wait = [backoff, 300].min
          Rails.logger.error "#{tag} unexpected error (attempt #{consecutive_errors}): #{e.class}: #{e.message} — retrying in #{wait}s"
          backoff = [backoff * 2, 300].min

          if consecutive_errors >= MAX_CONSECUTIVE_ERRORS
            Rails.logger.error "#{tag} CRITICAL: #{MAX_CONSECUTIVE_ERRORS} consecutive errors — pausing #{DEAD_SLEEP_SECONDS}s"
            sleep DEAD_SLEEP_SECONDS
            consecutive_errors = 0
            backoff            = 5
          else
            sleep wait
          end
        end
      end
    end

    # ─── OpenSky aircraft positions ──────────────────────────────────────────
    Thread.new do
      Thread.current.name = "opensky-feed"
      authenticated = ENV["OPENSKY_USERNAME"].present?
      mode = authenticated ? "authenticated" : "anonymous — 300s startup delay, ~400 req/day"
      Rails.logger.info "[OpenSkyFeed] started (#{mode}) — polling every 900s (4 boxes × 12s apart)"

      sleep Feeds::OpenSkyIngestionService::STARTUP_DELAY unless authenticated

      feed_loop.call("[OpenSkyFeed]", 900) { Feeds::OpenSkyIngestionService.call }
    end

    # ─── USGS seismic events ─────────────────────────────────────────────────
    Thread.new do
      Thread.current.name = "usgs-feed"
      Rails.logger.info "[USGSFeed] started — polling every 300s (M2.5+ global)"

      feed_loop.call("[USGSFeed]", 300) { Feeds::UsgsSeismicIngestionService.call }
    end

    # ─── GPSJam interference ─────────────────────────────────────────────────
    Thread.new do
      Thread.current.name = "gpsjam-feed"
      Rails.logger.info "[GPSJamFeed] started — polling every 900s"

      feed_loop.call("[GPSJamFeed]", 900) { Feeds::GpsjamIngestionService.call }
    end

    # ─── AIS vessel positions (requires AISHUB_USERNAME) ─────────────────────
    if ENV["AISHUB_USERNAME"].present?
      Thread.new do
        Thread.current.name = "ais-feed"
        Rails.logger.info "[AISFeed] started — polling every 30s across 4 theater boxes"

        feed_loop.call("[AISFeed]", 30) { Feeds::AisIngestionService.call }
      end
    else
      Rails.logger.info "[AISFeed] AISHUB_USERNAME not set — vessel feed disabled (see .env.example)"
    end

    # ─── NASA FIRMS wildfire (requires NASA_FIRMS_MAP_KEY) ───────────────────
    if ENV["NASA_FIRMS_MAP_KEY"].present?
      Thread.new do
        Thread.current.name = "firms-feed"
        Rails.logger.info "[FIRMSFeed] started — polling every 900s (VIIRS SNPP NRT)"

        feed_loop.call("[FIRMSFeed]", 900) { Feeds::FirmsWildfireIngestionService.call }
      end
    else
      Rails.logger.info "[FIRMSFeed] NASA_FIRMS_MAP_KEY not set — wildfire feed disabled (see .env.example)"
    end

    # ─── GDACS disaster alerts (no key required) ─────────────────────────────
    Thread.new do
      Thread.current.name = "gdacs-feed"
      Rails.logger.info "[GDACSFeed] started — polling every 900s (EQ,TC,FL,VO,DR,TS — global)"

      feed_loop.call("[GDACSFeed]", 900) { Feeds::GdacsIngestionService.call }
    end

    # ─── ACLED conflict events (requires ACLED_API_KEY + ACLED_EMAIL) ────────
    if ENV["ACLED_API_KEY"].present? && ENV["ACLED_EMAIL"].present?
      Thread.new do
        Thread.current.name = "acled-feed"
        Rails.logger.info "[ACLEDFeed] started — polling every 3600s (armed conflict events, 3-day lookback)"

        feed_loop.call("[ACLEDFeed]", 3600) { Feeds::AcledIngestionService.call }
      end
    else
      Rails.logger.info "[ACLEDFeed] ACLED_API_KEY or ACLED_EMAIL not set — conflict feed disabled (see .env.example)"
    end

  end
end
