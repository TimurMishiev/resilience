require "net/http"
require "json"

module Feeds
  # Polls the ACLED (Armed Conflict Location & Event Data Project) API for recent
  # armed conflict events and ingests them as conflict_event ExternalSignal records.
  #
  # ACLED covers battles, explosions/remote violence, violence against civilians,
  # protests, riots, and strategic developments — globally, updated daily.
  # Free API registration: https://developer.acleddata.com/
  #
  # Required environment variables:
  #   ACLED_API_KEY   — API key from your ACLED account
  #   ACLED_EMAIL     — Email address registered with ACLED
  #
  # Poll interval: 3600s (1 hour) — ACLED data is updated daily, polling hourly
  # is sufficient and stays well within free tier rate limits.
  # See config/initializers/feed_ingestion.rb for thread setup.
  #
  # Fatalities field is stored as `magnitude` so correlation rules can use
  # count thresholds (e.g. "conflict_event with fatalities >= 10 within 50km").
  class AcledIngestionService < ApplicationService
    include SslHelper

    BASE_URL    = "https://api.acleddata.com/acled/read"
    TIMEOUT     = 30
    LOOKBACK_DAYS = 3   # fetch last 3 days on each poll; IngestService deduplicates
    PER_PAGE    = 500   # ACLED allows up to 500 per request on free tier

    LOG_THROTTLE_SECONDS = 3600

    # Theater bounding boxes [latmin, latmax, lonmin, lonmax]
    # Mirrors the boxes used by GPSJam and OpenSky services.
    THEATER_BOXES = [
      { name: "Eastern Europe", latmin: 40.0, latmax: 55.0, lonmin: 15.0, lonmax: 45.0 },
      { name: "Middle East",    latmin: 22.0, latmax: 40.0, lonmin: 25.0, lonmax: 60.0 },
      { name: "Horn of Africa", latmin:  5.0, latmax: 20.0, lonmin: 30.0, lonmax: 55.0 },
      { name: "Indo-Pacific",   latmin: -5.0, latmax: 45.0, lonmin: 60.0, lonmax: 145.0 }
    ].freeze

    def call
      @last_logged_error ||= {}

      api_key = ENV["ACLED_API_KEY"].to_s.strip
      email   = ENV["ACLED_EMAIL"].to_s.strip

      if api_key.empty? || email.empty?
        Rails.logger.warn "[ACLEDFeed] ACLED_API_KEY or ACLED_EMAIL missing — skipping poll"
        return ServiceResult.success(ingested: 0)
      end

      uri = build_uri(api_key, email)
      http = ssl_http(uri.host, uri.port, timeout: TIMEOUT)
      response = http.get(uri.request_uri)

      unless response.code == "200"
        throttled_warn("fetch", "HTTP #{response.code}")
        return ServiceResult.success(ingested: 0)
      end

      body = JSON.parse(response.body)
      events = body["data"] || []
      ingested = 0

      events.each do |event|
        lat = event["latitude"].to_f
        lng = event["longitude"].to_f

        next unless lat != 0.0 || lng != 0.0   # skip zero-coordinates (bad geocode)
        next unless in_any_theater?(lat, lng)

        result = ingest_event(event, lat, lng)
        ingested += 1 if result&.success && result.payload[:created]
      end

      ServiceResult.success(ingested: ingested)
    rescue JSON::ParserError => e
      throttled_warn("parse", "JSON parse error: #{e.message}")
      ServiceResult.success(ingested: 0)
    rescue => e
      throttled_warn("exception", e.message)
      ServiceResult.success(ingested: 0)
    end

    private

    def build_uri(api_key, email)
      from_date = LOOKBACK_DAYS.days.ago.strftime("%Y-%m-%d")
      to_date   = Date.today.to_s

      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        key:              api_key,
        email:            email,
        event_date:       "#{from_date}|#{to_date}",
        event_date_where: "BETWEEN",
        limit:            PER_PAGE,
        fields:           "event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|latitude|longitude|fatalities|notes"
      )
      uri
    end

    def in_any_theater?(lat, lng)
      THEATER_BOXES.any? do |box|
        lat.between?(box[:latmin], box[:latmax]) &&
          lng.between?(box[:lonmin], box[:lonmax])
      end
    end

    def ingest_event(event, lat, lng)
      external_id = event["event_id_cnty"].presence ||
                    "acled_#{lat.round(4)}_#{lng.round(4)}_#{event['event_date']}"

      # Parse ACLED date string "YYYY-MM-DD" into a UTC timestamp (noon UTC so
      # it falls within the calendar day for any theater timezone).
      occurred_at = begin
        Date.parse(event["event_date"].to_s).in_time_zone("UTC").noon
      rescue ArgumentError
        Time.current.utc
      end

      fatalities = event["fatalities"].to_i

      Signals::IngestService.call(
        source:      "acled",
        signal_type: "conflict_event",
        external_id: external_id,
        lat:         lat,
        lng:         lng,
        occurred_at: occurred_at,
        magnitude:   fatalities.positive? ? fatalities.to_f : nil,
        raw_payload: {
          event_type:     event["event_type"],
          sub_event_type: event["sub_event_type"],
          actor1:         event["actor1"],
          actor2:         event["actor2"],
          country:        event["country"],
          fatalities:     fatalities,
          notes:          event["notes"]&.truncate(500)
        }
      )
    rescue => e
      Rails.logger.warn "[ACLEDFeed] failed to ingest event #{external_id}: #{e.message}"
      nil
    end

    def throttled_warn(key, message)
      last = @last_logged_error&.dig(key)
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[ACLEDFeed] #{message}"
      (@last_logged_error ||= {})[key] = Time.current
    end
  end
end
