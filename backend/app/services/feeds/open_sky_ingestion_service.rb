require "net/http"
require "json"
require "openssl"

module Feeds
  # Polls the OpenSky Network REST API for live aircraft positions and ingests
  # them as ExternalSignal records via Signals::IngestService.
  #
  # Authentication (recommended):
  #   Set OPENSKY_USERNAME + OPENSKY_PASSWORD in .env.
  #   Free account at https://opensky-network.org/
  #   Authenticated limit: 4,000 req/day — 10× the anonymous cap.
  #
  # Anonymous fallback (no credentials set):
  #   Limit: ~400 req/day, burst ~10 req/min.
  #   First poll deferred by STARTUP_DELAY (300s) to survive dev restarts
  #   without burning the daily quota.
  #
  # Either way we poll 4 bounding boxes every 900s (15 min) with 12s gaps
  # between boxes = 384 req/day — safely under both limits.
  class OpenSkyIngestionService < ApplicationService
    # Audit P3 follow-up (2026-04-29, post-deploy log review): all six
    # other feed services (ACLED, AIS, FIRMS, GDACS, GPSJam, USGS) include
    # this helper to call `ssl_http`. OpenSkyIngestionService called the
    # method without the include, raising
    # `NoMethodError: undefined method 'ssl_http'` on every fetch and
    # silently degrading the feed via the rescue at the call site
    # (line ~145). Production logs confirmed the error after the
    # `c44754c` deploy: every OpenSky poll failed with this exact
    # message. Six feeds working + one broken indicates this was a
    # missed include when the SslHelper extraction shipped.
    include SslHelper

    BASE_URL      = "https://opensky-network.org/api/states/all"
    TIMEOUT       = 15  # seconds per HTTP request

    # Defer the first anonymous poll by 5 minutes so rapid dev restarts do not
    # exhaust the 400 req/day quota. Ignored when credentials are present.
    STARTUP_DELAY = 300 # seconds

    # Suppress repeated fetch-error log lines: at most once per hour per box.
    # Class-level so the window persists across service instantiations/poll cycles.
    LOG_THROTTLE_SECONDS = 3600

    @last_logged_error = Concurrent::Map.new
    class << self
      attr_reader :last_logged_error
    end

    # Bounding boxes covering the 4 seed site theaters.
    BOUNDING_BOXES = [
      { name: "Eastern Europe",  lamin: 44.0, lomin: 22.0, lamax: 52.0, lomax: 40.0 },
      { name: "Middle East",     lamin: 29.0, lomin: 34.0, lamax: 35.0, lomax: 45.0 },
      { name: "Horn of Africa",  lamin: 10.0, lomin: 42.0, lamax: 13.0, lomax: 45.0 },
      { name: "Indo-Pacific",    lamin:  1.0, lomin: 73.0, lamax:  8.0, lomax: 104.0 }
    ].freeze

    def call
      metrics = Feeds::PollMetrics.new(feed: "opensky")
      total_ingested = 0
      metrics.increment(:query_box_count, BOUNDING_BOXES.size)

      BOUNDING_BOXES.each_with_index do |box, idx|
        sleep 12 if idx > 0  # 12s gap between boxes — avoids burst 429s
        response = fetch_box(box, metrics)
        next unless response

        server_time = response["time"].to_i
        states      = response["states"] || []
        metrics.increment(:fetched_count, states.size)

        states.each do |state|
          metrics.observe_external_time(state_time(state, server_time))
          result = ingest_state(state, server_time)
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

    # Returns the OpenSky username from env, or nil for anonymous mode.
    def opensky_username = ENV["OPENSKY_USERNAME"].presence
    def opensky_password = ENV["OPENSKY_PASSWORD"].presence

    # OpenSky state vector field indices:
    # 0  icao24         — ICAO 24-bit transponder address
    # 1  callsign       — aircraft callsign (may have trailing spaces)
    # 2  origin_country
    # 3  time_position  — unix ms of last position update (may be nil)
    # 4  last_contact   — unix ms of last contact
    # 5  longitude      — WGS-84 (nil if no GPS fix)
    # 6  latitude       — WGS-84
    # 7  geo_altitude   — geometric altitude in metres
    # 8  on_ground      — bool
    # 9  velocity       — ground speed m/s
    # 10 true_track     — heading in degrees
    # 11 vertical_rate  — m/s
    # 12 sensors        — array of receiver IDs
    # 13 baro_altitude  — barometric altitude in metres
    def ingest_state(state, server_time)
      icao24 = state[0]
      lng    = state[5]
      lat    = state[6]
      return nil unless lat && lng

      position_time = state[3] || state[4] || server_time
      return nil if position_time.nil? || position_time.zero?

      Signals::IngestService.call(
        source:      "opensky",
        signal_type: "aircraft_position",
        external_id: icao24.to_s,
        lat:         lat.to_f,
        lng:         lng.to_f,
        altitude:    state[7],
        speed:       state[9],
        heading:     state[10],
        occurred_at: Time.at(position_time).utc,
        raw_payload: {
          icao24:         icao24,
          callsign:       state[1]&.strip,
          origin_country: state[2],
          on_ground:      state[8],
          baro_altitude:  state[13],
          vertical_rate:  state[11]
        }
      )
    rescue => e
      Rails.logger.warn "[OpenSkyFeed] failed to ingest state #{state&.first}: #{e.class}: #{e.message}"
      nil
    end

    def fetch_box(box, metrics)
      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        lamin: box[:lamin], lomin: box[:lomin],
        lamax: box[:lamax], lomax: box[:lomax]
      )

      http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)

      response = Feeds::PayloadGuards.safe_get(
        http,
        uri.request_uri,
        basic_auth: opensky_username ? [ opensky_username, opensky_password ] : nil,
      )

      unless response.code == "200"
        throttled_warn(box[:name], "HTTP #{response.code}")
        metrics.increment(:error_count)
        raise Feeds::TransientHttpError, "HTTP #{response.code}" if response.code.start_with?("5")
        return nil
      end

      Feeds::PayloadGuards.safe_parse_json(response.body)
    rescue => e
      throttled_warn(box[:name], e.message)
      metrics.increment(:error_count)
      raise if Feeds::TransientErrors.match?(e)
      nil
    end

    def state_time(state, server_time)
      position_time = state[3] || state[4] || server_time
      return nil if position_time.nil? || position_time.to_i.zero?

      Time.at(position_time).utc
    end

    # Logs a warning for +key+ at most once per LOG_THROTTLE_SECONDS.
    def throttled_warn(key, message)
      store = self.class.last_logged_error
      last  = store[key]
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[OpenSkyFeed] fetch error for #{key}: #{message}"
      store[key] = Time.current
    end
  end
end
