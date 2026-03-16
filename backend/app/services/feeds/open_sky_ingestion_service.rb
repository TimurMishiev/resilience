require "net/http"
require "json"
require "openssl"

module Feeds
  # Polls the OpenSky Network REST API for live aircraft positions and ingests
  # them as Signal records via Signals::IngestService.
  #
  # OpenSky anonymous rate limit: ~400 req/day, burst limit ~10 req/min.
  # We poll 4 bounding boxes every 900s (15 min) = 384 req/day total.
  # A 12s gap between box fetches avoids burst rejection.
  #
  # STARTUP_DELAY: first poll is deferred by 5 minutes. This prevents rapid
  # server restarts (common in development) from burning through the daily
  # quota before the first real request cycle has run.
  class OpenSkyIngestionService < ApplicationService
    BASE_URL      = "https://opensky-network.org/api/states/all"
    TIMEOUT       = 15  # seconds per request
    STARTUP_DELAY = 300 # seconds — defer first poll to survive dev restarts

    # How often (seconds) to repeat the same fetch-error message in the log.
    # Prevents log spam when OpenSky is down for extended periods.
    # Class-level hash so the throttle persists across poll cycles (not just
    # within one call), which is critical for surviving a 429-rate-limited period.
    LOG_THROTTLE_SECONDS = 3600 # 1 hour

    # Class-level error log tracker — survives across service instantiations.
    @last_logged_error = {}
    class << self
      attr_accessor :last_logged_error
    end

    # verify_callback for OpenSky SSL connections.
    #
    # OpenSky's certificate chain includes a CRL Distribution Point (CDP)
    # whose server is intermittently unreachable. We still do full VERIFY_PEER
    # (hostname + chain + trusted CA). We only waive errors 3 and 33, which
    # mean "CRL server unreachable" — not "cert is revoked". A revoked cert
    # produces error 23 (CERT_REVOKED) which is NOT skipped here.
    #
    #   3  = X509_V_ERR_UNABLE_TO_GET_CRL
    #   23 = X509_V_ERR_CERT_REVOKED          (NOT skipped — still rejected)
    #   33 = X509_V_ERR_UNABLE_TO_GET_CRL_ISSUER
    #
    # Note: Net::HTTP on this Ruby version exposes verify_callback as a direct
    # attribute on the HTTP object, not via ssl_context=.
    SSL_VERIFY_CALLBACK = proc { |preverify_ok, store_ctx|
      if !preverify_ok && [3, 33].include?(store_ctx.error)
        true
      else
        preverify_ok
      end
    }.freeze

    # Bounding boxes that cover the 4 seed site theaters.
    # lamin/lamax = latitude bounds, lomin/lomax = longitude bounds.
    BOUNDING_BOXES = [
      { name: "Eastern Europe",  lamin: 44.0, lomin: 22.0, lamax: 52.0, lomax: 40.0 },
      { name: "Middle East",     lamin: 29.0, lomin: 34.0, lamax: 35.0, lomax: 45.0 },
      { name: "Horn of Africa",  lamin: 10.0, lomin: 42.0, lamax: 13.0, lomax: 45.0 },
      { name: "Indo-Pacific",    lamin:  1.0, lomin: 73.0, lamax:  8.0, lomax: 104.0 }
    ].freeze

    def call
      total_ingested = 0

      BOUNDING_BOXES.each_with_index do |box, idx|
        sleep 12 if idx > 0  # spread requests 12s apart — avoids burst 429s
        response = fetch_box(box)
        next unless response

        server_time = response["time"].to_i
        states      = response["states"] || []

        states.each do |state|
          result = ingest_state(state, server_time)
          total_ingested += 1 if result&.success && result.payload[:created]
        end
      end

      ServiceResult.success(ingested: total_ingested)
    rescue => e
      ServiceResult.failure(errors: [e.message])
    end

    private

    # OpenSky state vector indices:
    # 0  icao24          — unique ICAO 24-bit transponder address
    # 1  callsign        — aircraft callsign (may have trailing spaces)
    # 2  origin_country
    # 3  time_position   — unix timestamp of last position report (may be nil)
    # 4  last_contact    — unix timestamp of last contact
    # 5  longitude       — WGS-84 longitude (may be nil if on ground without GPS)
    # 6  latitude        — WGS-84 latitude
    # 7  geo_altitude    — geometric altitude in metres
    # 8  on_ground       — bool
    # 9  velocity        — ground speed in m/s
    # 10 true_track      — true track angle (heading) in degrees
    # 11 vertical_rate   — m/s
    # 12 sensors         — array of receiver IDs
    # 13 baro_altitude   — barometric altitude in metres
    def ingest_state(state, server_time)
      icao24 = state[0]
      lng    = state[5]
      lat    = state[6]

      # Skip aircraft without a current GPS fix
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

    def fetch_box(box)
      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        lamin: box[:lamin], lomin: box[:lomin],
        lamax: box[:lamax], lomax: box[:lomax]
      )

      http                  = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl          = true
      http.verify_callback  = SSL_VERIFY_CALLBACK
      http.open_timeout     = TIMEOUT
      http.read_timeout     = TIMEOUT

      request  = Net::HTTP::Get.new(uri)
      response = http.request(request)

      unless response.code == "200"
        throttled_warn(box[:name], "HTTP #{response.code}")
        return nil
      end

      JSON.parse(response.body)
    rescue => e
      throttled_warn(box[:name], e.message)
      nil
    end

    # Log a warning for +key+ at most once per LOG_THROTTLE_SECONDS interval.
    # Uses the class-level hash so the throttle persists across poll cycles and
    # server-reload hot-patches — not just within one call's 4-box iteration.
    def throttled_warn(key, message)
      store = self.class.last_logged_error
      last  = store[key]
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[OpenSkyFeed] fetch error for #{key}: #{message}"
      store[key] = Time.current
    end
  end
end
