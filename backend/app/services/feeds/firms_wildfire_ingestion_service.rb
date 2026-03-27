require "net/http"
require "csv"
require "json"

module Feeds
  # Polls NASA FIRMS (Fire Information for Resource Management System) for
  # near-real-time wildfire detections and ingests them as ExternalSignal records
  # via Signals::IngestService.
  #
  # Requires NASA_FIRMS_MAP_KEY environment variable.
  # Free API key: https://firms.modaps.eosdis.nasa.gov/api/map_key/
  # (Register with NASA EarthData — instant, no review required)
  #
  # Product: VIIRS SNPP Near Real-Time (NRT) — ~3-hour latency, global coverage.
  # Poll interval: 15 minutes (900 s) — see config/initializers/feed_ingestion.rb
  # Lookback: 1 day (DAYS=1) — avoids gaps; IngestService deduplicates by unique index.
  class FirmsWildfireIngestionService < ApplicationService
    include SslHelper

    BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
    PRODUCT  = "VIIRS_SNPP_NRT"
    DAYS     = 1    # VIIRS confidence values: "h" (high), "n" (nominal), "l" (low)
    # Skip low-confidence detections to reduce false positives.
    SKIP_CONFIDENCE = %w[l].freeze
    TIMEOUT = 25

    # One area string per theater: "west,south,east,north"
    BOUNDING_BOXES = [
      { name: "Eastern Europe", area: "15,40,45,55" },
      { name: "Middle East",    area: "25,22,60,40" },
      { name: "Horn of Africa", area: "30,5,55,20"  },
      { name: "Indo-Pacific",   area: "60,-5,145,45" }
    ].freeze

    def call
      metrics = Feeds::PollMetrics.new(feed: "firms_wildfire")
      map_key = ENV["NASA_FIRMS_MAP_KEY"]
      if map_key.blank?
        return ServiceResult.failure(
          errors: ["NASA_FIRMS_MAP_KEY not configured"],
          payload: { feed_health: metrics.finish(status: "disabled", errors: ["NASA_FIRMS_MAP_KEY not configured"]) },
        )
      end

      total_ingested = 0
      metrics.increment(:query_box_count, BOUNDING_BOXES.size)

      BOUNDING_BOXES.each do |box|
        rows = fetch_box(box, map_key, metrics)
        next unless rows

        metrics.increment(:fetched_count, rows.size)
        rows.each do |row|
          metrics.observe_external_time(parse_acquisition_time(row["acq_date"], row["acq_time"]))
          result = ingest_row(row)
          if result&.success
            if result.payload[:created]
              total_ingested += 1
              metrics.increment(:ingested_count)
            else
              metrics.increment(:duplicate_count)
            end
          else
            metrics.increment(:skipped_count)
          end
        end
      end

      ServiceResult.success(metrics.success_payload)
    rescue => e
      metrics.increment(:error_count)
      ServiceResult.failure(errors: [e.message], payload: { feed_health: metrics.finish(status: "error", errors: [e.message]) })
    end

    private

    def fetch_box(box, map_key, metrics)
      url = "#{BASE_URL}/#{map_key}/#{PRODUCT}/#{box[:area]}/#{DAYS}"
      uri = URI(url)

      http     = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response = http.get(uri.request_uri)
      unless response.code == "200"
        Rails.logger.warn "[FIRMSFeed] HTTP #{response.code} for #{box[:name]}"
        metrics.increment(:error_count)
        return nil
      end

      CSV.parse(response.body, headers: true, skip_blanks: true)
    rescue => e
      Rails.logger.warn "[FIRMSFeed] fetch error for #{box[:name]}: #{e.message}"
      metrics.increment(:error_count)
      nil
    end

    def parse_acquisition_time(acq_date, acq_time)
      return nil if acq_date.blank? || acq_time.blank?

      Time.strptime("#{acq_date} #{acq_time.to_s.rjust(4, '0')} UTC",
                    "%Y-%m-%d %H%M %Z")
    rescue ArgumentError
      nil
    end

    # FIRMS VIIRS_SNPP_NRT CSV columns:
    #   latitude   — decimal degrees
    #   longitude  — decimal degrees
    #   bright_ti4 — brightness temperature band I-4 in Kelvin (fire pixel)
    #   bright_ti5 — brightness temperature band I-5 in Kelvin (background)
    #   scan       — scan pixel size in km (east-west)
    #   track      — track pixel size in km (north-south)
    #   acq_date   — "YYYY-MM-DD" UTC acquisition date
    #   acq_time   — "HHMM" UTC acquisition time (zero-padded)
    #   satellite  — "N" (Suomi NPP) or "N20" (NOAA-20)
    #   instrument — "VIIRS"
    #   confidence — "l" low / "n" nominal / "h" high
    #   version    — dataset version string
    #   frp        — fire radiative power in MW (proxy for fire intensity)
    #   daynight   — "D" daytime or "N" nighttime detection
    def ingest_row(row)
      lat      = row["latitude"]&.to_f
      lng      = row["longitude"]&.to_f
      acq_date = row["acq_date"]
      acq_time = row["acq_time"]
      return nil unless lat && lng && acq_date && acq_time

      # Skip low-confidence detections
      return nil if SKIP_CONFIDENCE.include?(row["confidence"]&.downcase)

      occurred_at = begin
        # acq_time is HHMM zero-padded, e.g. "0735"
        Time.strptime("#{acq_date} #{acq_time.to_s.rjust(4, '0')} UTC",
                      "%Y-%m-%d %H%M %Z")
      rescue ArgumentError
        Time.current.utc
      end

      # Stable composite key: date + time + rounded lat/lng.
      # Avoids floating-point collisions while staying unique per detection.
      external_id = "#{acq_date}_#{acq_time}_#{lat.round(4)}_#{lng.round(4)}"

      # FRP (fire radiative power, MW) maps naturally to the magnitude field —
      # higher FRP = larger fire = more operationally significant.
      frp = row["frp"]&.to_f

      Signals::IngestService.call(
        source:      "firms_wildfire",
        signal_type: "wildfire",
        external_id: external_id,
        lat:         lat,
        lng:         lng,
        magnitude:   frp,
        occurred_at: occurred_at,
        raw_payload: {
          bright_ti4: row["bright_ti4"]&.to_f,
          bright_ti5: row["bright_ti5"]&.to_f,
          frp:        frp,
          confidence: row["confidence"],
          satellite:  row["satellite"],
          instrument: row["instrument"],
          daynight:   row["daynight"],
          scan:       row["scan"]&.to_f,
          track:      row["track"]&.to_f
        }
      )
    rescue => e
      Rails.logger.warn "[FIRMSFeed] failed to ingest row: #{e.message}"
      nil
    end
  end
end
