require "net/http"
require "json"
require "set"

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
    PER_PAGE    = 5000  # ACLED v4.2 paginates 5000 rows per page by default

    LOG_THROTTLE_SECONDS = 3600
    SITE_SCOPE_RADIUS_KM = 250.0
    MAX_QUERY_BOXES      = 50 # cap merged boxes to bound API calls per poll

    # Class-level so the throttle window persists across service instantiations.
    # Concurrent::Map is thread-safe for multi-threaded Puma / Solid Queue workers.
    @last_logged_error = Concurrent::Map.new
    class << self
      attr_reader :last_logged_error
    end

    def call
      metrics = Feeds::PollMetrics.new(feed: "acled")

      api_key = ENV["ACLED_API_KEY"].to_s.strip
      email   = ENV["ACLED_EMAIL"].to_s.strip

      if api_key.empty? || email.empty?
        Rails.logger.warn "[ACLEDFeed] ACLED_API_KEY or ACLED_EMAIL missing — skipping poll"
        return ServiceResult.success(metrics.success_payload(status: "disabled", errors: ["ACLED_API_KEY or ACLED_EMAIL missing"]))
      end

      boxes = query_boxes
      if boxes.empty?
        Rails.logger.info "[ACLEDFeed] no active site/AO footprint — skipping poll"
        return ServiceResult.success(metrics.success_payload(status: "no_scope"))
      end

      ingested = 0
      seen_event_ids = Set.new
      http = ssl_http(URI(BASE_URL).host, URI(BASE_URL).port, timeout: TIMEOUT)
      metrics.increment(:query_box_count, boxes.size)

      boxes.each do |box|
        fetch_events_for_box(http, api_key, email, box, metrics).each do |event|
          lat = event["latitude"].to_f
          lng = event["longitude"].to_f

          if lat == 0.0 && lng == 0.0
            metrics.increment(:skipped_count)
            next
          end
          unless point_in_box?(box, lat, lng)
            metrics.increment(:skipped_count)
            next
          end

          event_id = event_identity(event, lat, lng)
          unless seen_event_ids.add?(event_id)
            metrics.increment(:duplicate_count)
            next
          end

          metrics.observe_external_time(parse_event_date(event["event_date"]))

          result = ingest_event(event, lat, lng)
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

    def build_uri(api_key, email, box:, page:)
      from_date = LOOKBACK_DAYS.days.ago.strftime("%Y-%m-%d")
      to_date   = Date.today.to_s

      uri = URI(BASE_URL)
      uri.query = URI.encode_www_form(
        key:              api_key,
        email:            email,
        event_date:       "#{from_date}|#{to_date}",
        event_date_where: "BETWEEN",
        latitude:         "#{box[:latmin]}|#{box[:latmax]}",
        latitude_where:   "BETWEEN",
        longitude:        "#{box[:lonmin]}|#{box[:lonmax]}",
        longitude_where:  "BETWEEN",
        limit:            PER_PAGE,
        page:             page,
        fields:           "event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|latitude|longitude|fatalities|notes"
      )
      uri
    end

    def fetch_events_for_box(http, api_key, email, box, metrics)
      page = 1
      events = []

      loop do
        uri = build_uri(api_key, email, box: box, page: page)
        response = http.get(uri.request_uri)

        unless response.code == "200"
          throttled_warn("fetch", "HTTP #{response.code}")
          metrics.increment(:error_count)
          break
        end

        body = JSON.parse(response.body)
        page_events = Array(body["data"])
        metrics.increment(:page_count)
        metrics.increment(:fetched_count, page_events.size)
        events.concat(page_events)
        break if page_events.size < PER_PAGE

        page += 1
      end

      events
    end

    def parse_event_date(value)
      return nil if value.blank?

      Date.parse(value.to_s).in_time_zone("UTC").noon
    rescue ArgumentError
      nil
    end

    def query_boxes
      boxes = []

      Site.active.includes(:area_of_operation).find_each do |site|
        boxes << site_scope_box(site)
        boxes << geometry_box(site.area_of_operation.geometry) if site.area_of_operation&.geometry.present?
      end

      # Include AO polygons that have no active site attached — an operator may
      # define an ops footprint before deploying any sites into it.
      AreaOfOperation.where.not(geometry: nil).find_each do |ao|
        boxes << geometry_box(ao.geometry)
      end

      merged = merge_boxes(boxes.compact)

      if merged.size > MAX_QUERY_BOXES
        Rails.logger.warn "[ACLEDFeed] #{merged.size} query boxes exceed cap (#{MAX_QUERY_BOXES}) — truncating by area"
        merged = merged.sort_by { |b| -((b[:latmax] - b[:latmin]) * (b[:lonmax] - b[:lonmin])) }
                       .first(MAX_QUERY_BOXES)
      end

      merged
    end

    def site_scope_box(site)
      radius_km = [ site.geofence_radius_km.to_f, SITE_SCOPE_RADIUS_KM ].max
      lat = site.latitude.to_f
      lng = site.longitude.to_f
      lat_delta = radius_km / 111.0
      lng_scale = [ Math.cos(lat * Math::PI / 180.0).abs, 0.1 ].max
      lng_delta = radius_km / (111.0 * lng_scale)

      normalize_box(
        latmin: lat - lat_delta,
        latmax: lat + lat_delta,
        lonmin: lng - lng_delta,
        lonmax: lng + lng_delta,
      )
    end

    def geometry_box(geometry)
      coords = extract_coordinate_pairs(geometry&.dig("coordinates"))
      return nil if coords.empty?

      lngs = coords.map(&:first)
      lats = coords.map(&:last)
      normalize_box(
        latmin: lats.min,
        latmax: lats.max,
        lonmin: lngs.min,
        lonmax: lngs.max,
      )
    end

    def extract_coordinate_pairs(value)
      return [] unless value.is_a?(Array)
      if value.length >= 2 && value[0].is_a?(Numeric) && value[1].is_a?(Numeric)
        return [[ value[0].to_f, value[1].to_f ]]
      end

      value.flat_map { |entry| extract_coordinate_pairs(entry) }
    end

    def normalize_box(latmin:, latmax:, lonmin:, lonmax:)
      {
        latmin: [ latmin, -90.0 ].max,
        latmax: [ latmax, 90.0 ].min,
        lonmin: [ lonmin, -180.0 ].max,
        lonmax: [ lonmax, 180.0 ].min,
      }
    end

    def merge_boxes(boxes)
      merged = []

      boxes.each do |box|
        overlapping_index = merged.find_index { |existing| boxes_overlap?(existing, box) }
        if overlapping_index.nil?
          merged << box
          next
        end

        existing = merged[overlapping_index]
        merged[overlapping_index] = normalize_box(
          latmin: [ existing[:latmin], box[:latmin] ].min,
          latmax: [ existing[:latmax], box[:latmax] ].max,
          lonmin: [ existing[:lonmin], box[:lonmin] ].min,
          lonmax: [ existing[:lonmax], box[:lonmax] ].max,
        )
      end

      merged
    end

    def boxes_overlap?(left, right)
      left[:latmin] <= right[:latmax] &&
        right[:latmin] <= left[:latmax] &&
        left[:lonmin] <= right[:lonmax] &&
        right[:lonmin] <= left[:lonmax]
    end

    def point_in_box?(box, lat, lng)
      lat.between?(box[:latmin], box[:latmax]) &&
        lng.between?(box[:lonmin], box[:lonmax])
    end

    def event_identity(event, lat, lng)
      event["event_id_cnty"].presence ||
        "acled_#{lat.round(4)}_#{lng.round(4)}_#{event['event_date']}"
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
      store = self.class.last_logged_error
      last  = store[key]
      return if last && Time.current - last < LOG_THROTTLE_SECONDS

      Rails.logger.warn "[ACLEDFeed] #{message}"
      store[key] = Time.current
    end
  end
end
