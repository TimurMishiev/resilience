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

    # Theater bounding boxes [latmin, latmax, lonmin, lonmax]
    THEATER_BOXES = [
      { name: "Eastern Europe", latmin: 40.0, latmax: 55.0, lonmin: 15.0, lonmax: 45.0 },
      { name: "Middle East",    latmin: 22.0, latmax: 40.0, lonmin: 25.0, lonmax: 60.0 },
      { name: "Horn of Africa", latmin:  5.0, latmax: 20.0, lonmin: 30.0, lonmax: 55.0 },
      { name: "Indo-Pacific",   latmin: -5.0, latmax: 45.0, lonmin: 60.0, lonmax: 145.0 }
    ].freeze

    def call
      @last_logged_error ||= {}

      # GPSJam data lags 1-2 days — try yesterday first, then day before
      csv_body = fetch_csv_for(Date.today - 1) || fetch_csv_for(Date.today - 2)

      unless csv_body
        throttled_warn("fetch", "no data available for last 2 days")
        return ServiceResult.success(ingested: 0)
      end

      ingested = parse_and_ingest(csv_body)
      ServiceResult.success(ingested: ingested)
    rescue => e
      throttled_warn("exception", e.message)
      ServiceResult.success(ingested: 0)
    end

    private

    # Returns decompressed CSV body string, or nil if the date is unavailable.
    def fetch_csv_for(date)
      uri  = URI("#{BASE_URL}/#{date}-h3_4.csv")
      http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      resp = http.get(uri.request_uri, "Accept-Encoding" => "gzip")

      return nil unless resp.code == "200"

      body = resp.body
      # Decompress if gzip
      if resp["Content-Encoding"] == "gzip" || body.b.start_with?("\x1F\x8B".b)
        body = Zlib::GzipReader.new(StringIO.new(body)).read
      end
      body
    rescue => e
      throttled_warn("fetch_#{date}", e.message)
      nil
    end

    def parse_and_ingest(csv_body)
      ingested = 0

      CSV.parse(csv_body, headers: true) do |row|
        hex_str = row["hex"]&.strip
        next if hex_str.blank?

        good = row["count_good_aircraft"].to_i
        bad  = row["count_bad_aircraft"].to_i
        total = good + bad
        next if total.zero?

        signal_level = bad.to_f / total
        next if signal_level < MIN_SIGNAL

        h3_index = hex_str.to_i(16)
        lat, lng = H3.h3_to_geo_coords(h3_index)
        next unless lat && lng
        next unless in_any_theater?(lat, lng)

        result = ingest_hexagon(hex_str, lat, lng, signal_level)
        ingested += 1 if result&.success && result.payload[:created]
      end

      ingested
    end

    def throttled_warn(key, message)
      last = @last_logged_error&.dig(key)
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[GPSJamFeed] #{message}"
      (@last_logged_error ||= {})[key] = Time.current
    end

    def in_any_theater?(lat, lng)
      THEATER_BOXES.any? do |box|
        lat.between?(box[:latmin], box[:latmax]) &&
          lng.between?(box[:lonmin], box[:lonmax])
      end
    end

    def ingest_hexagon(hex_str, lat, lng, signal_level)
      Signals::IngestService.call(
        source:      "gpsjam",
        signal_type: "gps_jamming",
        external_id: hex_str,
        lat:         lat.round(6),
        lng:         lng.round(6),
        occurred_at: Time.current.utc,
        raw_payload: { signal_level: signal_level, hex_id: hex_str }
      )
    rescue => e
      Rails.logger.warn "[GPSJamFeed] failed to ingest hexagon #{hex_str}: #{e.message}"
      nil
    end
  end
end
