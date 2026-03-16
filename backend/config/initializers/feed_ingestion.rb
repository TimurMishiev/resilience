# Starts all live-feed ingestion background threads after Rails has fully booted.
# Each feed polls a public data source and ingests ExternalSignal records via
# Signals::IngestService (idempotent — unique index prevents duplicate ingestion).
#
# Skipped in test mode, rake tasks, and Rails console.
#
# Feed summary:
#   opensky-feed   — aircraft positions (OpenSky Network, no key)    — 900s
#   usgs-feed      — seismic events     (USGS FDSN, no key)          — 300s
#   gpsjam-feed    — GPS interference   (gpsjam.org, no key)         — 900s
#   ais-feed       — vessel positions   (AIS Hub, AISHUB_USERNAME)   — 30s
#   firms-feed     — wildfire hotspots  (NASA FIRMS, NASA_FIRMS_MAP_KEY) — 900s
#
# AIS and FIRMS feeds require API keys; threads are skipped if keys are absent.
# See backend/.env.example for all required variables.
unless Rails.env.test? || defined?(Rails::Console) || File.basename($PROGRAM_NAME) == "rake"
  Rails.application.config.after_initialize do

    # ─── OpenSky aircraft positions ──────────────────────────────────────────
    Thread.new do
      Thread.current.name = "opensky-feed"
      # Defer first poll by STARTUP_DELAY (300s). Rapid dev restarts otherwise
      # exhaust the 400 req/day anonymous quota before the app has warmed up.
      delay = Feeds::OpenSkyIngestionService::STARTUP_DELAY
      Rails.logger.info "[OpenSkyFeed] started — first poll in #{delay}s, then every 900s (4 boxes × 12s apart)"
      sleep delay

      loop do
        begin
          result = Feeds::OpenSkyIngestionService.call
          if result.success
            count = result.payload[:ingested]
            Rails.logger.info "[OpenSkyFeed] ingested #{count} new signals" if count.to_i > 0
          else
            Rails.logger.warn "[OpenSkyFeed] errors: #{result.errors.join(', ')}"
          end
        rescue ActiveRecord::StatementInvalid, PG::Error => e
          Rails.logger.error "[OpenSkyFeed] DB error: #{e.message}"
          sleep 30
          next
        rescue => e
          Rails.logger.error "[OpenSkyFeed] unexpected error: #{e.message}"
        end

        sleep 900  # 15 minutes — 4 boxes × 12s apart = 384 req/day, under anonymous limit
      end
    end

    # ─── USGS seismic events ─────────────────────────────────────────────────
    Thread.new do
      Thread.current.name = "usgs-feed"
      Rails.logger.info "[USGSFeed] started — polling every 300s (M2.5+ global)"

      loop do
        begin
          result = Feeds::UsgsSeismicIngestionService.call
          if result.success
            count = result.payload[:ingested]
            Rails.logger.info "[USGSFeed] ingested #{count} new seismic events" if count.to_i > 0
          else
            Rails.logger.warn "[USGSFeed] errors: #{result.errors.join(', ')}"
          end
        rescue ActiveRecord::StatementInvalid, PG::Error => e
          Rails.logger.error "[USGSFeed] DB error: #{e.message}"
          sleep 30
          next
        rescue => e
          Rails.logger.error "[USGSFeed] unexpected error: #{e.message}"
        end

        sleep 300  # 5 minutes
      end
    end

    # ─── GPSJam interference ─────────────────────────────────────────────────
    Thread.new do
      Thread.current.name = "gpsjam-feed"
      Rails.logger.info "[GPSJamFeed] started — polling every 900s"

      loop do
        begin
          result = Feeds::GpsjamIngestionService.call
          if result.success
            count = result.payload[:ingested]
            Rails.logger.info "[GPSJamFeed] ingested #{count} jamming hexagons" if count.to_i > 0
          else
            Rails.logger.warn "[GPSJamFeed] errors: #{result.errors.join(', ')}"
          end
        rescue ActiveRecord::StatementInvalid, PG::Error => e
          Rails.logger.error "[GPSJamFeed] DB error: #{e.message}"
          sleep 30
          next
        rescue => e
          Rails.logger.error "[GPSJamFeed] unexpected error: #{e.message}"
        end

        sleep 900  # 15 minutes
      end
    end

    # ─── AIS vessel positions (requires AISHUB_USERNAME) ─────────────────────
    if ENV["AISHUB_USERNAME"].present?
      Thread.new do
        Thread.current.name = "ais-feed"
        Rails.logger.info "[AISFeed] started — polling every 30s across 4 theater boxes"

        loop do
          begin
            result = Feeds::AisIngestionService.call
            if result.success
              count = result.payload[:ingested]
              Rails.logger.info "[AISFeed] ingested #{count} new vessel positions" if count.to_i > 0
            else
              Rails.logger.warn "[AISFeed] errors: #{result.errors.join(', ')}"
            end
          rescue ActiveRecord::StatementInvalid, PG::Error => e
            Rails.logger.error "[AISFeed] DB error: #{e.message}"
            sleep 30
            next
          rescue => e
            Rails.logger.error "[AISFeed] unexpected error: #{e.message}"
          end

          sleep 30
        end
      end
    else
      Rails.logger.info "[AISFeed] AISHUB_USERNAME not set — vessel feed disabled (see .env.example)"
    end

    # ─── NASA FIRMS wildfire (requires NASA_FIRMS_MAP_KEY) ───────────────────
    if ENV["NASA_FIRMS_MAP_KEY"].present?
      Thread.new do
        Thread.current.name = "firms-feed"
        Rails.logger.info "[FIRMSFeed] started — polling every 900s (VIIRS SNPP NRT)"

        loop do
          begin
            result = Feeds::FirmsWildfireIngestionService.call
            if result.success
              count = result.payload[:ingested]
              Rails.logger.info "[FIRMSFeed] ingested #{count} new wildfire detections" if count.to_i > 0
            else
              Rails.logger.warn "[FIRMSFeed] errors: #{result.errors.join(', ')}"
            end
          rescue ActiveRecord::StatementInvalid, PG::Error => e
            Rails.logger.error "[FIRMSFeed] DB error: #{e.message}"
            sleep 30
            next
          rescue => e
            Rails.logger.error "[FIRMSFeed] unexpected error: #{e.message}"
          end

          sleep 900  # 15 minutes
        end
      end
    else
      Rails.logger.info "[FIRMSFeed] NASA_FIRMS_MAP_KEY not set — wildfire feed disabled (see .env.example)"
    end

  end
end
