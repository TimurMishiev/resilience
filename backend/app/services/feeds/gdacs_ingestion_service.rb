require "net/http"
require "json"

module Feeds
  # Polls the GDACS (Global Disaster Alerting and Coordination System) JSON API
  # for recent disaster events and ingests them as disaster_alert ExternalSignal records.
  #
  # GDACS is a UN-operated framework covering earthquakes, floods, tropical cyclones,
  # tsunamis, volcanoes, droughts, and wildfires — globally, updated every ~5 minutes.
  # No API key required. https://www.gdacs.org/
  #
  # Poll interval: 900s (15 min) — respectful of the public API, still near-real-time.
  # See config/initializers/feed_ingestion.rb for thread setup.
  #
  # Magnitude field: `episodealertscore` (continuous 0–3+ float, uniform across all
  # event types) so correlation rules can apply consistent thresholds:
  #   ≥ 0 → Green (minor), ≥ 1 → Orange (moderate), ≥ 2 → Red (major crisis)
  #
  # Unlike our other feeds, GDACS events are globally significant and low-volume
  # (~10–30 active events at any time), so no theater-box filtering is applied —
  # all active events worldwide are ingested and visible on the map.
  class GdacsIngestionService < ApplicationService
    include SslHelper

    BASE_URL      = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    TIMEOUT       = 30
    LOOKBACK_DAYS = 4   # GDACS keeps events active for days/weeks; dedup handles repeats
    EVENT_TYPES   = "EQ,TC,FL,VO,DR,TS"  # excludes WF (FIRMS already covers wildfires)
    ALERT_LEVELS  = "Red,Orange,Green"

    LOG_THROTTLE_SECONDS = 3600

    # Class-level log-throttle state persists across service instantiations so
    # the 1-hour window actually works. Thread-safe via Concurrent::Map.
    @last_logged_error = Concurrent::Map.new
    class << self
      attr_reader :last_logged_error
    end

    # Maps two-letter GDACS event codes to human-readable names stored in raw_payload.
    EVENT_TYPE_NAMES = {
      "EQ" => "Earthquake",
      "TC" => "Tropical Cyclone",
      "FL" => "Flood",
      "VO" => "Volcano",
      "DR" => "Drought",
      "TS" => "Tsunami"
    }.freeze

    def call
      metrics = Feeds::PollMetrics.new(feed: "gdacs")

      uri  = build_uri
      http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response = Feeds::PayloadGuards.safe_get(http, uri.request_uri)

      unless response.code == "200"
        throttled_warn("fetch", "HTTP #{response.code}")
        metrics.increment(:error_count)
        return ServiceResult.success(metrics.success_payload(status: "degraded", errors: ["HTTP #{response.code}"]))
      end

      body     = Feeds::PayloadGuards.safe_parse_json(response.body)
      features = body["features"] || []
      ingested = 0
      metrics.increment(:fetched_count, features.size)

      features.each do |feature|
        metrics.observe_external_time(parse_timestamp(feature.dig("properties", "fromdate")))
        result = ingest_feature(feature)
        if result&.success
          if result.payload[:created]
            ingested += 1
            metrics.increment(:ingested_count)
          else
            metrics.increment(:duplicate_count)
          end
        else
          metrics.increment(:skipped_count)
        end
      end

      ServiceResult.success(metrics.success_payload)
    rescue JSON::ParserError => e
      throttled_warn("parse", "JSON parse error: #{e.message}")
      metrics.increment(:error_count)
      ServiceResult.success(metrics.success_payload(status: "degraded", errors: ["JSON parse error: #{e.message}"]))
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

    def build_uri
      from_date = LOOKBACK_DAYS.days.ago.strftime("%Y-%m-%d")
      to_date   = Date.today.to_s

      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        eventlist:  EVENT_TYPES,
        alertlevel: ALERT_LEVELS,
        fromdate:   from_date,
        todate:     to_date,
        pagenumber: 1
      )
      uri
    end

    def ingest_feature(feature)
      props = feature["properties"] || {}
      geo   = feature["geometry"]   || {}

      # Coordinates are [lng, lat] per GeoJSON spec
      coords = geo["coordinates"]
      return nil unless coords&.length == 2

      lng = coords[0].to_f
      lat = coords[1].to_f
      return nil if lat == 0.0 && lng == 0.0   # unmapped event

      event_type = props["eventtype"].to_s.upcase
      event_id   = props["eventid"]
      episode_id = props["episodeid"]

      return nil unless event_id.present?

      # Stable ID across polls: type + event + episode captures distinct event episodes
      external_id = "gdacs_#{event_type}_#{event_id}_#{episode_id}"

      occurred_at = parse_timestamp(props["fromdate"])

      # episodealertscore is a uniform 0-3+ float across all event types.
      # Fall back to integer alertscore (1=Green, 2=Orange, 3=Red) if absent.
      alert_score = props.dig("severitydata", "episodealertscore") ||
                    props["episodealertscore"] ||
                    props["alertscore"]
      magnitude = alert_score.to_f > 0 ? alert_score.to_f.round(3) : nil

      Signals::IngestService.call(
        source:      "gdacs",
        signal_type: "disaster_alert",
        external_id: external_id,
        lat:         lat,
        lng:         lng,
        occurred_at: occurred_at,
        magnitude:   magnitude,
        raw_payload: {
          event_type:       event_type,
          event_type_name:  EVENT_TYPE_NAMES[event_type] || event_type,
          event_id:         event_id,
          episode_id:       episode_id,
          name:             props["name"],
          country:          props["country"],
          iso3:             props["iso3"],
          alert_level:      props["alertlevel"],
          alert_score:      alert_score,
          severity_text:    props.dig("severitydata", "severitytext"),
          severity_value:   props.dig("severitydata", "severity"),
          severity_unit:    props.dig("severitydata", "severityunit"),
          is_current:       props["iscurrent"],
          to_date:          props["todate"]
        }
      )
    rescue => e
      Rails.logger.warn "[GDACSFeed] failed to ingest event #{external_id}: #{e.class}: #{e.message}"
      nil
    end

    # GDACS timestamps are ISO 8601 without a timezone offset ("2026-03-20T20:06:52").
    # Treat as UTC — all GDACS data is published in UTC.
    def parse_timestamp(raw)
      return Time.current.utc if raw.blank?

      Time.parse("#{raw}Z").utc
    rescue ArgumentError
      Time.current.utc
    end

    def throttled_warn(key, message)
      last = self.class.last_logged_error[key]
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[GDACSFeed] #{message}"
      self.class.last_logged_error[key] = Time.current
    end
  end
end
