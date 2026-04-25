require "net/http"
require "json"

module Feeds
  # Polls AIS Hub (https://www.aishub.net/) for live vessel positions across
  # the 4 operational theater bounding boxes and ingests them as ExternalSignal
  # records via Signals::IngestService.
  #
  # Requires AISHUB_USERNAME environment variable.
  # Free registration at: https://www.aishub.net/join-us
  #
  # AIS Hub returns the last known position for all vessels within the bounding
  # box (positions updated within the last 30 minutes).
  # Poll interval: 30 seconds — see config/initializers/feed_ingestion.rb
  class AisIngestionService < ApplicationService
    include SslHelper

    BASE_URL = "https://data.aishub.net/ws.php"
    TIMEOUT  = 15  # seconds per request

    # AIS NAVSTAT code 511 = "not available" — filter out undefined headings
    HEADING_UNAVAILABLE = 511

    # Same geographic boxes as the OpenSky feed so all theater feeds are aligned
    BOUNDING_BOXES = [
      { name: "Eastern Europe", latmin: 44.0, lonmin: 22.0, latmax: 52.0, lonmax: 40.0 },
      { name: "Middle East",    latmin: 29.0, lonmin: 34.0, latmax: 35.0, lonmax: 45.0 },
      { name: "Horn of Africa", latmin: 10.0, lonmin: 42.0, latmax: 13.0, lonmax: 45.0 },
      { name: "Indo-Pacific",   latmin:  1.0, lonmin: 73.0, latmax:  8.0, lonmax: 104.0 }
    ].freeze

    def call
      metrics = Feeds::PollMetrics.new(feed: "ais")
      username = ENV["AISHUB_USERNAME"]
      if username.blank?
        return ServiceResult.failure(
          errors: ["AISHUB_USERNAME not configured"],
          payload: { feed_health: metrics.finish(status: "disabled", errors: ["AISHUB_USERNAME not configured"]) },
        )
      end

      total_ingested = 0
      metrics.increment(:query_box_count, BOUNDING_BOXES.size)

      BOUNDING_BOXES.each do |box|
        vessels = fetch_box(box, username, metrics)
        next unless vessels

        metrics.increment(:fetched_count, vessels.size)
        vessels.each do |vessel|
          metrics.observe_external_time(parse_vessel_time(vessel["TIME"]))
          result = ingest_vessel(vessel)
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
      metrics.finish(status: "error", errors: [e.message])
      raise if Feeds::TransientErrors.match?(e) # let PollJob retry network failures
      ServiceResult.failure(errors: [e.message])
    end

    private

    def fetch_box(box, username, metrics)
      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        username: username,
        format:   1,
        output:   "json",
        compress: 0,
        latmin:   box[:latmin],
        latmax:   box[:latmax],
        lonmin:   box[:lonmin],
        lonmax:   box[:lonmax]
      )

      http     = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response = Feeds::PayloadGuards.safe_get(http, uri.request_uri)

      unless response.code == "200"
        Rails.logger.warn "[AISFeed] HTTP #{response.code} for #{box[:name]}"
        metrics.increment(:error_count)
        raise Feeds::TransientHttpError, "HTTP #{response.code}" if response.code.start_with?("5")
        return nil
      end

      parsed = Feeds::PayloadGuards.safe_parse_json(response.body)

      # AIS Hub response format: [metadata_hash, vessel_hash, vessel_hash, ...]
      # where metadata_hash = {"ERROR": false, "USERNAME": "...", ...}
      # On auth failure: {"ERROR": true, "ERRORMESSAGE": "..."}
      if parsed.is_a?(Hash) && parsed["ERROR"]
        metrics.increment(:error_count)
        return nil
      end
      return nil unless parsed.is_a?(Array) && parsed.length > 1

      metadata = parsed.first
      if metadata.is_a?(Hash) && metadata["ERROR"]
        Rails.logger.warn "[AISFeed] API error for #{box[:name]}: #{metadata['ERRORMESSAGE']}"
        metrics.increment(:error_count)
        return nil
      end

      parsed[1..]  # Drop the metadata entry; remaining elements are vessel records
    rescue => e
      Rails.logger.warn "[AISFeed] fetch error for #{box[:name]}: #{e.class}: #{e.message}"
      metrics.increment(:error_count)
      raise if Feeds::TransientErrors.match?(e)
      nil
    end

    def parse_vessel_time(value)
      return nil if value.blank?

      Time.parse("#{value} UTC")
    rescue ArgumentError
      nil
    end

    # AIS Hub vessel record fields:
    #   MMSI       — Maritime Mobile Service Identity (9-digit unique vessel ID)
    #   TIME       — "YYYY-MM-DD HH:MM:SS" UTC, last position timestamp
    #   LONGITUDE  — decimal degrees WGS-84
    #   LATITUDE   — decimal degrees WGS-84
    #   COG        — course over ground in degrees (0–359.9, 360 = not available)
    #   SOG        — speed over ground in knots (102.3 = not available)
    #   HEADING    — true heading in degrees (511 = not available)
    #   ROT        — rate of turn (-128 to 127, -128 = not available)
    #   NAVSTAT    — AIS navigational status (0=under way, 1=at anchor, …)
    #   NAME       — vessel name (may be empty string)
    #   CALLSIGN   — vessel radio callsign
    #   TYPE       — AIS vessel type code (0–99)
    #   DRAUGHT    — draught in decimetres
    #   DEST       — destination port
    def ingest_vessel(vessel)
      mmsi     = vessel["MMSI"]
      lat      = vessel["LATITUDE"]
      lng      = vessel["LONGITUDE"]
      time_str = vessel["TIME"]

      return nil unless mmsi && lat && lng && time_str

      occurred_at = begin
        Time.parse("#{time_str} UTC")
      rescue ArgumentError
        Time.current
      end

      # SOG in knots — convert to m/s for consistency with OpenSky (1 kn ≈ 0.514 m/s)
      sog_knots = vessel["SOG"]&.to_f
      speed_ms  = (sog_knots && sog_knots < 102.3) ? (sog_knots * 0.514444).round(2) : nil

      heading = vessel["HEADING"]&.to_i
      heading = nil if heading == HEADING_UNAVAILABLE

      result = Signals::IngestService.call(
        source:      "ais",
        signal_type: "vessel_position",
        external_id: mmsi.to_s,
        lat:         lat.to_f,
        lng:         lng.to_f,
        speed:       speed_ms,
        heading:     heading&.to_f,
        occurred_at: occurred_at,
        raw_payload: {
          mmsi:        mmsi,
          name:        vessel["NAME"]&.strip.presence,
          callsign:    vessel["CALLSIGN"]&.strip.presence,
          cog:         vessel["COG"]&.to_f,
          sog_knots:   sog_knots,
          nav_stat:    vessel["NAVSTAT"],
          vessel_type: vessel["TYPE"],
          draught:     vessel["DRAUGHT"],
          dest:        vessel["DEST"]&.strip.presence
        }
      )

      # Update vessel entity state on every successful AIS ping — whether or not
      # the signal was newly created. We always want the vessel's current position
      # to reflect the latest observation.
      #
      # Design note: upsert lives here (not in IngestService) because IngestService
      # is a generic signal persister. Vessel state management is AIS-specific
      # concern. When manual injection is added, it will also call upsert — at
      # that point we extract Vessels::StateUpdaterService (YAGNI until then).
      if result.success
        signal  = result.payload[:signal]
        vessel, = Vessel.upsert_from_signal!(signal)

        # Append a track point only for newly created signals — not replays.
        # This prevents duplicate track points when the same (mmsi, occurred_at)
        # comes back on a re-poll within the same AIS Hub 30-min window.
        if result.payload[:created] && vessel
          VesselTrack.create!(
            vessel:     vessel,
            lat:        signal.lat,
            lng:        signal.lng,
            speed:      signal.speed,
            heading:    signal.heading,
            occurred_at: signal.occurred_at
          )
        end
      end

      result
    rescue => e
      Rails.logger.warn "[AISFeed] failed to ingest vessel #{vessel&.dig('MMSI')}: #{e.class}: #{e.message}"
      nil
    end
  end
end
