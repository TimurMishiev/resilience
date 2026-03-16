require "net/http"
require "json"

module Feeds
  # Polls the USGS Earthquake Hazards Programme (FDSN Event Web Service) for
  # recent seismic events and ingests them as ExternalSignal records via
  # Signals::IngestService.
  #
  # Free, no API key required.
  # https://earthquake.usgs.gov/fdsnws/event/1/
  #
  # Poll interval: 5 minutes (300 s) — see config/initializers/feed_ingestion.rb
  # Lookback window: 24 hours — ensures the table is immediately populated after
  # a restart or seed clear. Deduplication via unique index (source, external_id,
  # occurred_at) makes repeated fetches of the same window idempotent at zero cost.
  # Min magnitude: 2.5 — filters out micro-tremors that don't affect operations.
  class UsgsSeismicIngestionService < ApplicationService
    include SslHelper

    BASE_URL         = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    MIN_MAGNITUDE    = 2.5
    LOOKBACK_MINUTES = 1440  # 24 hours — deduplication keeps re-fetches idempotent
    TIMEOUT          = 20  # seconds per HTTP request

    def call
      uri = URI(BASE_URL)
      now = Time.current.utc
      uri.query = URI.encode_www_form(
        format:       "geojson",
        starttime:    (now - LOOKBACK_MINUTES.minutes).strftime("%Y-%m-%dT%H:%M:%S"),
        endtime:      now.strftime("%Y-%m-%dT%H:%M:%S"),
        minmagnitude: MIN_MAGNITUDE,
        orderby:      "time"
      )

      http     = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response = http.get(uri.request_uri)
      unless response.code == "200"
        return ServiceResult.failure(errors: ["HTTP #{response.code}"])
      end

      data     = JSON.parse(response.body)
      features = data["features"] || []
      ingested = 0

      features.each do |feature|
        result = ingest_feature(feature)
        ingested += 1 if result&.success && result.payload[:created]
      end

      ServiceResult.success(ingested: ingested)
    rescue => e
      ServiceResult.failure(errors: [e.message])
    end

    private

    # USGS GeoJSON feature anatomy:
    #   feature["id"]                        — e.g. "us7000lmgb"
    #   feature["properties"]["mag"]         — float magnitude
    #   feature["properties"]["place"]       — human-readable location description
    #   feature["properties"]["time"]        — Unix milliseconds UTC
    #   feature["properties"]["magType"]     — "ml", "mb", "mw", …
    #   feature["properties"]["alert"]       — PAGER alert level (nil/green/yellow/orange/red)
    #   feature["properties"]["tsunami"]     — 1 if tsunami potential, 0 otherwise
    #   feature["geometry"]["coordinates"]   — [longitude, latitude, depth_km]
    def ingest_feature(feature)
      props  = feature["properties"] || {}
      coords = feature.dig("geometry", "coordinates")
      return nil unless coords && props["time"] && props["mag"]

      lng     = coords[0].to_f
      lat     = coords[1].to_f
      time_ms = props["time"].to_i

      Signals::IngestService.call(
        source:      "usgs_seismic",
        signal_type: "seismic_event",
        external_id: feature["id"],
        lat:         lat,
        lng:         lng,
        magnitude:   props["mag"].to_f,
        occurred_at: Time.at(time_ms / 1000.0).utc,
        raw_payload: {
          mag:      props["mag"],
          place:    props["place"],
          depth_km: coords[2],
          mag_type: props["magType"],
          alert:    props["alert"],
          tsunami:  props["tsunami"]
        }
      )
    rescue => e
      Rails.logger.warn "[USGSFeed] failed to ingest #{feature['id']}: #{e.message}"
      nil
    end
  end
end
