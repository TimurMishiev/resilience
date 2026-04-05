module Ai
  class CircuitBreaker
    FAILURE_THRESHOLD = 3
    OPEN_WINDOW       = 2.minutes
    CACHE_TTL         = 10.minutes
    CACHE_KEY_PREFIX  = "ai/circuit_breaker"

    KNOWN_SERVICES = %w[
      task_filter signal_filter summary ontology_query recommendation_llm_enricher
    ].freeze

    class << self
      # Returns a hash of { service_name => { status:, failures: } } for all
      # known AI breaker services, suitable for metrics/health dashboards.
      def status_snapshot
        KNOWN_SERVICES.each_with_object({}) do |service, map|
          state = read_state(service:) || {}
          failures = (state[:failures] || state["failures"] || 0).to_i
          opened_at = parse_time(state[:opened_at] || state["opened_at"])
          is_open = opened_at.present? && opened_at >= OPEN_WINDOW.ago

          map[service] = {
            status: is_open ? "open" : "closed",
            failures: failures,
          }
        end
      end

      def open?(service:)
        state = read_state(service:)
        return false if state.blank?

        opened_at = parse_time(state[:opened_at] || state["opened_at"])
        return false unless opened_at

        if opened_at >= OPEN_WINDOW.ago
          true
        else
          record_success(service:)
          false
        end
      end

      def record_failure(service:)
        state = read_state(service:) || {}
        failures = (state[:failures] || state["failures"] || 0).to_i + 1
        payload = { failures: failures }
        payload[:opened_at] = Time.current.iso8601(3) if failures >= FAILURE_THRESHOLD

        cache_store.write(cache_key(service), payload, expires_in: CACHE_TTL)
        payload
      end

      def record_success(service:)
        cache_store.delete(cache_key(service))
      end

      private

      def read_state(service:)
        cache_store.read(cache_key(service))
      end

      def cache_key(service)
        "#{CACHE_KEY_PREFIX}/#{service}"
      end

      def cache_store
        return Rails.cache unless Rails.cache.is_a?(ActiveSupport::Cache::NullStore)

        @fallback_cache_store ||= ActiveSupport::Cache::MemoryStore.new
      end

      def parse_time(value)
        return value if value.is_a?(Time)
        return if value.blank?

        Time.zone.parse(value.to_s)
      rescue ArgumentError, TypeError
        nil
      end
    end
  end
end
