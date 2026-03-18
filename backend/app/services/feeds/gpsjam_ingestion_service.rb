require "net/http"
require "json"

module Feeds
  # Polls gpsjam.org for GPS interference heatmap data and ingests high-confidence
  # jamming detections as ExternalSignal records via Signals::IngestService.
  #
  # No API key required.  GPSJam publishes a GeoJSON endpoint used by their
  # public map frontend.  Data is derived from ADS-B receiver networks that
  # detect GPS signal degradation in aircraft navigation.
  #
  # Poll interval: 15 minutes (900 s) — data is refreshed periodically by GPSJam,
  # not in real time. see config/initializers/feed_ingestion.rb
  #
  # Each feature is an H3 hexagon polygon.  We compute the centroid, filter to
  # our 4 theater bounding boxes, and ingest hexagons with signal >= MIN_SIGNAL.
  class GpsjamIngestionService < ApplicationService
    include SslHelper

    # GPSJam exposes H3 hexagon heatmap data via a GeoJSON endpoint.
    # Non-200 responses are treated as "no data available" (success, 0 ingested)
    # rather than errors, since the endpoint URL may change without notice.
    BASE_URL   = "https://gpsjam.org/geo.json"
    TIMEOUT    = 20
    MIN_SIGNAL = 0.5  # 0.0 = no jamming, 1.0 = heavy jamming — skip noise below 50%

    # Log fetch errors at most once per hour to avoid log spam when the endpoint
    # is temporarily unavailable or has changed.
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
      uri       = URI(BASE_URL)
      uri.query = URI.encode_www_form(date: Date.today.to_s)
      http      = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response  = http.get(uri.request_uri)

      unless response.code == "200"
        # Treat non-200 as "no data" rather than an error — endpoint may be
        # temporarily unavailable or URL may have changed.  Throttle the log.
        throttled_warn("fetch", "HTTP #{response.code}")
        return ServiceResult.success(ingested: 0)
      end

      data     = JSON.parse(response.body)
      features = data["features"] || []
      ingested = 0

      features.each do |feature|
        signal_level = feature.dig("properties", "signal").to_f
        next unless signal_level >= MIN_SIGNAL

        lat, lng = centroid(feature.dig("geometry", "coordinates", 0))
        next unless lat && lng
        next unless in_any_theater?(lat, lng)

        result = ingest_hexagon(feature, lat, lng, signal_level)
        ingested += 1 if result&.success && result.payload[:created]
      end

      ServiceResult.success(ingested: ingested)
    rescue => e
      throttled_warn("exception", e.message)
      ServiceResult.success(ingested: 0)
    end

    private

    def throttled_warn(key, message)
      last = @last_logged_error&.dig(key)
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[GPSJamFeed] #{message}"
      (@last_logged_error ||= {})[key] = Time.current
    end

    # Compute the centroid of a polygon ring (array of [lng, lat] coordinate pairs).
    # Returns [lat, lng].
    def centroid(ring)
      return nil unless ring&.any?

      sum_lng = ring.sum { |c| c[0] }
      sum_lat = ring.sum { |c| c[1] }
      n = ring.size.to_f
      [ (sum_lat / n).round(6), (sum_lng / n).round(6) ]
    end

    def in_any_theater?(lat, lng)
      THEATER_BOXES.any? do |box|
        lat.between?(box[:latmin], box[:latmax]) &&
          lng.between?(box[:lonmin], box[:lonmax])
      end
    end

    # Use the H3 hex index as external_id if present (stable across polls).
    # Fall back to a rounded lat/lng hash to maintain deduplication.
    # occurred_at = Time.current because jamming data reflects current conditions.
    def ingest_hexagon(feature, lat, lng, signal_level)
      hex_id      = feature["id"].presence || feature.dig("properties", "hex")
      external_id = hex_id || "#{lat.round(3)}_#{lng.round(3)}"

      Signals::IngestService.call(
        source:      "gpsjam",
        signal_type: "gps_jamming",
        external_id: external_id,
        lat:         lat,
        lng:         lng,
        occurred_at: Time.current.utc,
        raw_payload: {
          signal_level: signal_level,
          hex_id:       hex_id
        }
      )
    rescue => e
      Rails.logger.warn "[GPSJamFeed] failed to ingest hexagon #{external_id}: #{e.message}"
      nil
    end
  end
end
