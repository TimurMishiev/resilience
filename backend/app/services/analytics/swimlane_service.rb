module Analytics
  # Aggregates per-site timeline lanes for the live swimlane page.
  #
  # Reuses Sites::TimelineService so the swimlane surface and the site-detail
  # timeline speak the same event language.
  class SwimlaneService < ApplicationService
    VALID_KINDS = %w[
      signal_detected
      rule_fired
      task_created
      task_transitioned
      site_event
    ].freeze
    DEFAULT_DAYS       = 3
    MAX_DAYS           = 30
    DEFAULT_LANE_LIMIT = 8
    MAX_LANE_LIMIT     = 12
    MAX_VISIBLE_EVENTS = 24

    def initialize(days: DEFAULT_DAYS, kinds: nil, lane_limit: DEFAULT_LANE_LIMIT, site_ids: nil)
      @days       = (days.presence || DEFAULT_DAYS).to_i.clamp(1, MAX_DAYS)
      @kinds      = normalize_list(kinds, VALID_KINDS)
      @lane_limit = (lane_limit.presence || DEFAULT_LANE_LIMIT).to_i.clamp(1, MAX_LANE_LIMIT)
      @site_ids   = normalize_list(site_ids)
    end

    def call
      lanes = base_sites.filter_map { |site| build_lane(site) }
                        .sort_by { |lane| [lane[:last_event_at], lane[:event_count], lane[:site_name].downcase] }
                        .reverse
                        .first(@lane_limit)

      {
        data: lanes,
        meta: {
          days:              @days,
          lane_limit:        @lane_limit,
          lane_count:        lanes.size,
          total_events:      lanes.sum { |lane| lane[:event_count] },
          event_kinds:       @kinds.presence || VALID_KINDS,
          selected_site_ids: @site_ids
        }
      }
    end

    private

    def base_sites
      scope = Site.active.includes(:area_of_operation).order(:name)
      scope = scope.where(id: @site_ids) if @site_ids.any?
      # Cap at 100 to bound the number of TimelineService calls when no site
      # filter is provided. Sites with activity bubble up via sort-by-last-event,
      # so the highest-signal lanes are preserved within MAX_LANE_LIMIT=12.
      scope.limit(100).to_a
    end

    def build_lane(site)
      events = Sites::TimelineService.call(site: site, days: @days)
      events = events.select { |event| @kinds.include?(event[:event_kind]) } if @kinds.any?
      return nil if events.empty?

      visible_events = events.first(MAX_VISIBLE_EVENTS)

      {
        site_id:                site.id,
        site_name:              site.name,
        area_of_operation_id:   site.area_of_operation_id,
        area_of_operation_name: site.area_of_operation&.name,
        event_count:            events.size,
        visible_event_count:    visible_events.size,
        last_event_at:          events.first[:occurred_at],
        events:                 visible_events
      }
    end

    def normalize_list(values, allowed = nil)
      list = case values
             when String
               values.split(",")
             else
               Array(values)
             end

      normalized = list.map { |value| value.to_s.strip }
                       .reject(&:blank?)
      return normalized if allowed.nil?

      normalized & allowed
    end
  end
end
