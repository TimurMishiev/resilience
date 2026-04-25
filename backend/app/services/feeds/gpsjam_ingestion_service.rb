require "net/http"
require "csv"
require "zlib"
require "stringio"
require "h3"

module Feeds
  # Polls gpsjam.org for GPS interference heatmap data and ingests high-confidence
  # jamming detections as ExternalSignal records via Signals::IngestService.
  #
  # No API key required. GPSJam publishes daily compressed CSV files with H3
  # hexagon indices (resolution 4) and aircraft count data.
  #
  # API as of 2026: https://gpsjam.org/data/YYYY-MM-DD-h3_4.csv (gzip-compressed)
  # Columns: hex, count_good_aircraft, count_bad_aircraft
  # Data lags 1-2 days; we try today-1 then today-2 if unavailable.
  #
  # Signal level = count_bad / (count_good + count_bad) — same 0.0–1.0 range as
  # the old GeoJSON `signal` property.
  #
  # Poll interval: 15 minutes (900s). see config/initializers/feed_ingestion.rb
  class GpsjamIngestionService < ApplicationService
    include SslHelper

    BASE_URL   = "https://gpsjam.org/data"
    TIMEOUT    = 20
    MIN_SIGNAL = 0.5  # skip hexagons where <50% of aircraft see GPS degradation

    LOG_THROTTLE_SECONDS = 3600

    # Class-level log-throttle state persists across service instantiations so
    # the 1-hour window actually works. Thread-safe via Concurrent::Map.
    @last_logged_error = Concurrent::Map.new
    class << self
      attr_reader :last_logged_error
    end

    # Theater bounding boxes [latmin, latmax, lonmin, lonmax]
    THEATER_BOXES = [
      { name: "Eastern Europe", latmin: 40.0, latmax: 55.0, lonmin: 15.0, lonmax: 45.0 },
      { name: "Middle East",    latmin: 22.0, latmax: 40.0, lonmin: 25.0, lonmax: 60.0 },
      { name: "Horn of Africa", latmin:  5.0, latmax: 20.0, lonmin: 30.0, lonmax: 55.0 },
      { name: "Indo-Pacific",   latmin: -5.0, latmax: 45.0, lonmin: 60.0, lonmax: 145.0 }
    ].freeze

    def call
      metrics = Feeds::PollMetrics.new(feed: "gpsjam")
      metrics.increment(:query_box_count, THEATER_BOXES.size)

      # GPSJam data lags 1-2 days — try yesterday first, then day before
      source_date = Date.today - 1
      csv_body = fetch_csv_for(source_date, metrics)
      unless csv_body
        source_date = Date.today - 2
        csv_body = fetch_csv_for(source_date, metrics)
      end

      unless csv_body
        throttled_warn("fetch", "no data available for last 2 days")
        metrics.increment(:error_count)
        return ServiceResult.success(metrics.success_payload(status: "degraded", errors: ["no data available for last 2 days"]))
      end

      metrics.observe_external_time(source_date)
      ingested = parse_and_ingest(csv_body, metrics, source_date: source_date)
      ServiceResult.success(metrics.success_payload)
    rescue => e
      throttled_warn("exception", e.message)
      metrics.increment(:error_count)
      if Feeds::TransientErrors.match?(e)
        metrics.finish(status: "error", errors: [e.message])
        raise # let PollJob retry network failures
      end
      ServiceResult.success(metrics.success_payload(status: "degraded", errors: [e.message]))
    end

    private

    # Returns decompressed CSV body string, or nil if the date is unavailable.
    def fetch_csv_for(date, metrics)
      uri  = URI("#{BASE_URL}/#{date}-h3_4.csv")
      http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      resp = Feeds::PayloadGuards.safe_get(
        http,
        uri.request_uri,
        headers: { "Accept-Encoding" => "gzip" },
      )

      unless resp.code == "200"
        throttled_warn("fetch_#{date}", "HTTP #{resp.code}")
        metrics.increment(:error_count)
        raise Feeds::TransientHttpError, "HTTP #{resp.code}" if resp.code.start_with?("5")
        return nil
      end

      body = resp.body
      # Decompress if gzip — bounded by Feeds::PayloadGuards.safe_inflate's
      # decompressed-byte ceiling so a gzip bomb under the compressed
      # 25 MB cap cannot expand into a process-killing payload here.
      # Without this, a hostile upstream could ship 25 MB of compressed
      # zeros that inflates to 1+ GB and OOMs the worker — exactly the
      # OOM scenario Tranche 3A is supposed to close.
      if resp["Content-Encoding"] == "gzip" || body.b.start_with?("\x1F\x8B".b)
        body = Feeds::PayloadGuards.safe_inflate(body)
      end
      # Validate UTF-8 on the decompressed CSV body before parsing —
      # the byte cap already covered the compressed payload, but the
      # decompressed body could still smuggle invalid bytes through
      # CSV.parse.
      Feeds::PayloadGuards.normalise_utf8(body)
    rescue => e
      throttled_warn("fetch_#{date}", e.message)
      metrics.increment(:error_count)
      raise if Feeds::TransientErrors.match?(e)
      nil
    end

    def parse_and_ingest(csv_body, metrics, source_date:)
      ingested = 0

      CSV.parse(csv_body, headers: true) do |row|
        metrics.increment(:fetched_count)
        hex_str = row["hex"]&.strip
        if hex_str.blank?
          metrics.increment(:skipped_count)
          next
        end

        good = row["count_good_aircraft"].to_i
        bad  = row["count_bad_aircraft"].to_i
        total = good + bad
        if total.zero?
          metrics.increment(:skipped_count)
          next
        end

        signal_level = bad.to_f / total
        if signal_level < MIN_SIGNAL
          metrics.increment(:skipped_count)
          next
        end

        h3_index = hex_str.to_i(16)
        lat, lng = H3.to_geo_coordinates(h3_index)
        unless lat && lng
          metrics.increment(:skipped_count)
          next
        end
        unless in_any_theater?(lat, lng)
          metrics.increment(:skipped_count)
          next
        end

        result = ingest_hexagon(hex_str, lat, lng, signal_level, source_date: source_date)
        if result&.success
          if result.payload[:created]
            ingested += 1
            metrics.increment(:ingested_count)
          else
            metrics.increment(:duplicate_count)
          end
        else
          metrics.increment(:error_count)
        end
      end

      ingested
    end

    def throttled_warn(key, message)
      last = self.class.last_logged_error[key]
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[GPSJamFeed] #{message}"
      self.class.last_logged_error[key] = Time.current
    end

    def in_any_theater?(lat, lng)
      THEATER_BOXES.any? do |box|
        lat.between?(box[:latmin], box[:latmax]) &&
          lng.between?(box[:lonmin], box[:lonmax])
      end
    end

    def ingest_hexagon(hex_str, lat, lng, signal_level, source_date:)
      Signals::IngestService.call(
        source:      "gpsjam",
        signal_type: "gps_jamming",
        external_id: hex_str,
        lat:         lat.round(6),
        lng:         lng.round(6),
        occurred_at: source_date.in_time_zone("UTC").noon,
        raw_payload: { signal_level: signal_level, hex_id: hex_str, source_date: source_date.iso8601 }
      )
    rescue => e
      Rails.logger.warn "[GPSJamFeed] failed to ingest hexagon #{hex_str}: #{e.class}: #{e.message}"
      nil
    end
  end
end
