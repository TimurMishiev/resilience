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
    BASE_URL      = "https://opensky-network.org/api/states/all"
    TIMEOUT       = 15  # seconds per HTTP request

    # Defer the first anonymous poll by 5 minutes so rapid dev restarts do not
    # exhaust the 400 req/day quota. Ignored when credentials are present.
    STARTUP_DELAY = 300 # seconds

    # Suppress repeated fetch-error log lines: at most once per hour per box.
    # Class-level so the window persists across service instantiations/poll cycles.
    LOG_THROTTLE_SECONDS = 3600

    @last_logged_error = {}
    class << self
      attr_accessor :last_logged_error
    end

    # OpenSky SSL verify_callback — waives CRL-unreachable errors (3, 33) only.
    # Error 23 (CERT_REVOKED) is never waived.
    #   3  = X509_V_ERR_UNABLE_TO_GET_CRL
    #   33 = X509_V_ERR_UNABLE_TO_GET_CRL_ISSUER
    SSL_VERIFY_CALLBACK = proc { |preverify_ok, store_ctx|
      if !preverify_ok && [3, 33].include?(store_ctx.error)
        true
      else
        preverify_ok
      end
    }.freeze

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
      ServiceResult.failure(errors: [e.message], payload: { feed_health: metrics.finish(status: "error", errors: [e.message]) })
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
      Rails.logger.warn "[OpenSkyFeed] failed to ingest state #{state&.first}: #{e.message}"
      nil
    end

    def fetch_box(box, metrics)
      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        lamin: box[:lamin], lomin: box[:lomin],
        lamax: box[:lamax], lomax: box[:lomax]
      )

      http                 = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl         = true
      http.verify_callback = SSL_VERIFY_CALLBACK
      http.open_timeout    = TIMEOUT
      http.read_timeout    = TIMEOUT

      request = Net::HTTP::Get.new(uri)
      request.basic_auth(opensky_username, opensky_password) if opensky_username

      response = http.request(request)

      unless response.code == "200"
        throttled_warn(box[:name], "HTTP #{response.code}")
        metrics.increment(:error_count)
        return nil
      end

      JSON.parse(response.body)
    rescue => e
      throttled_warn(box[:name], e.message)
      metrics.increment(:error_count)
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
