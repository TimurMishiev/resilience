module Feeds
  class PollMetrics
    COUNT_KEYS = %i[
      fetched_count
      ingested_count
      duplicate_count
      skipped_count
      error_count
      page_count
      query_box_count
    ].freeze

    def self.record_disabled(feed:, errors:)
      new(feed: feed).finish(status: "disabled", errors: errors)
    end

    def initialize(feed:)
      @feed = feed.to_s
      @started_at = Time.current
      @counts = COUNT_KEYS.index_with(0)
      @last_external_occurred_at = nil
    end

    def increment(key, by = 1)
      @counts[key.to_sym] = @counts.fetch(key.to_sym, 0) + by.to_i
    end

    def observe_external_time(value)
      return if value.blank?

      timestamp =
        case value
        when Time then value
        when Date then value.in_time_zone("UTC").end_of_day
        else
          Time.zone.parse(value.to_s)
        end

      return unless timestamp

      @last_external_occurred_at =
        if @last_external_occurred_at.nil? || timestamp > @last_external_occurred_at
          timestamp
        else
          @last_external_occurred_at
        end
    rescue ArgumentError, TypeError
      nil
    end

    def success_payload(status: "ok", errors: [])
      { ingested: @counts[:ingested_count], feed_health: finish(status: status, errors: errors) }
    end

    def finish(status:, errors: [])
      finished_at = Time.current
      snapshot = {
        feed: @feed,
        status: status,
        started_at: @started_at.iso8601(3),
        finished_at: finished_at.iso8601(3),
        duration_ms: ((finished_at - @started_at) * 1000).round,
        fetched_count: @counts[:fetched_count],
        ingested_count: @counts[:ingested_count],
        duplicate_count: @counts[:duplicate_count],
        skipped_count: @counts[:skipped_count],
        error_count: @counts[:error_count],
        page_count: @counts[:page_count],
        query_box_count: @counts[:query_box_count],
      }
      snapshot[:last_external_occurred_at] = @last_external_occurred_at&.iso8601
      snapshot[:error_messages] = Array(errors).map(&:to_s).reject(&:blank?).first(3) if Array(errors).any?(&:present?)

      Feeds::HealthRegistry.record(snapshot)
      ActiveSupport::Notifications.instrument("feeds.poll", snapshot)
      Rails.logger.info("[FeedHealth] #{format_snapshot(snapshot)}")
      snapshot
    end

    private

    def format_snapshot(snapshot)
      snapshot.map do |key, value|
        formatted =
          case value
          when Array then value.join("|")
          else value
          end
        "#{key}=#{formatted}"
      end.join(" ")
    end
  end
end
