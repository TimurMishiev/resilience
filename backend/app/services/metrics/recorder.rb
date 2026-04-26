# frozen_string_literal: true

module Metrics
  # Collects and persists platform metrics to OperationalStatus (category: "metrics").
  #
  # Tracks six metric families:
  #   1. request_latency    — p50/p95/p99 latency per controller action (per-snapshot window)
  #   2. sse_connections     — current active SSE stream count (from SseStreamLease)
  #   3. feed_lag            — seconds since each feed's last successful poll
  #   4. ai_response_times   — per-snapshot p50/p95 for AI service calls
  #   5. ai_usage            — per-snapshot tokens + estimated cost + status breakdown for AI calls
  #   6. ai_circuit_breakers — open/closed status for each AI service breaker
  #
  # Called periodically by Metrics::SnapshotJob (every 60s — config/recurring.yml)
  # and writes to OperationalStatus so the Operational Health page can render it.
  #
  # LATENCY_WINDOW is the observation window published to consumers in
  # `window_seconds`. Because `persist_request_latency!` clears `@request_samples`
  # on every snapshot, the effective window equals the snapshot cadence. The
  # constant is kept in sync with that cadence so operators see a truthful
  # aggregation window, not an aspirational one.
  class Recorder
    LATENCY_WINDOW = 1.minute
    MAX_SAMPLES    = 500 # cap per endpoint to bound memory

    class << self
      # Thread-safe request latency accumulator.
      # Structure: { "Api::SitesController#index" => [12.3, 8.1, ...], ... }
      def request_samples
        @request_samples_mutex.synchronize { @request_samples.dup }
      end

      def record_request(controller:, action:, duration_ms:)
        key = "#{controller}##{action}"
        @request_samples_mutex.synchronize do
          (@request_samples[key] ||= []).push(duration_ms)
          @request_samples[key] = @request_samples[key].last(MAX_SAMPLES)
        end
      end

      def record_ai_call(service:, duration_ms:)
        @ai_samples_mutex.synchronize do
          (@ai_samples[service] ||= []).push(duration_ms)
          @ai_samples[service] = @ai_samples[service].last(MAX_SAMPLES)
        end
      end

      # Per-call cost/token capture. Aggregated into the ai_usage
      # snapshot so an operator can see model spend without hauling a
      # durable per-call billing ledger. Cleared on snapshot, same as
      # the latency arrays.
      def record_ai_usage(service:, model:, duration_ms:, input_tokens:, output_tokens:, total_tokens:, estimated_cost_usd:, status:)
        sample = {
          model:              model,
          duration_ms:        duration_ms,
          input_tokens:       input_tokens.to_i,
          output_tokens:      output_tokens.to_i,
          total_tokens:       total_tokens.to_i,
          estimated_cost_usd: estimated_cost_usd.to_f,
          status:             status,
        }
        @ai_usage_mutex.synchronize do
          (@ai_usage[service] ||= []).push(sample)
          @ai_usage[service] = @ai_usage[service].last(MAX_SAMPLES)
        end
      end

      # Take a snapshot and persist to OperationalStatus.
      def snapshot!
        persist_request_latency!
        persist_sse_connections!
        persist_feed_lag!
        persist_ai_response_times!
        persist_ai_usage!
        persist_circuit_breaker_status!
      end

      def reset!
        @request_samples_mutex.synchronize { @request_samples.clear }
        @ai_samples_mutex.synchronize { @ai_samples.clear }
        @ai_usage_mutex.synchronize { @ai_usage.clear }
      end

      private

      def persist_request_latency!
        samples = @request_samples_mutex.synchronize do
          snapshot = @request_samples.dup
          @request_samples.clear
          snapshot
        end

        return if samples.empty?

        endpoints = samples.map do |key, values|
          sorted = values.sort
          {
            endpoint: key,
            count: sorted.size,
            p50_ms: percentile(sorted, 50),
            p95_ms: percentile(sorted, 95),
            p99_ms: percentile(sorted, 99),
            max_ms: sorted.last&.round(1),
          }
        end.sort_by { |e| -e[:p95_ms] }.first(20) # top 20 by p95

        OperationalStatus.record!(
          category: "metrics",
          key: "request_latency",
          payload: { endpoints: endpoints, window_seconds: LATENCY_WINDOW.to_i, recorded_at: Time.current.iso8601 }
        )
      end

      def persist_sse_connections!
        by_stream = SseStreamLease.active_at(Time.current).group(:stream_name).count

        OperationalStatus.record!(
          category: "metrics",
          key: "sse_connections",
          payload: {
            total: by_stream.values.sum,
            by_stream: by_stream,
            recorded_at: Time.current.iso8601,
          }
        )
      end

      def persist_feed_lag!
        feeds = OperationalStatus.for_category("feed_health").map do |status|
          payload = status.payload
          finished_at = payload["finished_at"]
          lag_seconds = finished_at ? (Time.current - Time.parse(finished_at)).round : nil

          {
            feed: payload["feed"] || status.key,
            status: payload["status"],
            last_poll_at: finished_at,
            lag_seconds: lag_seconds,
            ingested_count: payload["ingested_count"],
            error_count: payload["error_count"],
          }
        end

        OperationalStatus.record!(
          category: "metrics",
          key: "feed_lag",
          payload: { feeds: feeds, recorded_at: Time.current.iso8601 }
        )
      end

      def persist_ai_response_times!
        samples = @ai_samples_mutex.synchronize do
          snapshot = @ai_samples.dup
          @ai_samples.clear
          snapshot
        end

        return if samples.empty?

        services = samples.map do |service, values|
          sorted = values.sort
          {
            service: service,
            count: sorted.size,
            p50_ms: percentile(sorted, 50),
            p95_ms: percentile(sorted, 95),
            max_ms: sorted.last&.round(1),
          }
        end

        OperationalStatus.record!(
          category: "metrics",
          key: "ai_response_times",
          payload: { services: services, recorded_at: Time.current.iso8601 }
        )
      end

      def persist_ai_usage!
        samples = @ai_usage_mutex.synchronize do
          snapshot = @ai_usage.dup
          @ai_usage.clear
          snapshot
        end

        return if samples.empty?

        services = samples.map do |service, calls|
          by_status = calls.group_by { |c| c[:status] }
          {
            service:             service,
            total_calls:         calls.size,
            success_calls:       by_status["success"]&.size || 0,
            error_calls:         by_status["error"]&.size || 0,
            timeout_calls:       by_status["timeout"]&.size || 0,
            total_input_tokens:  calls.sum { |c| c[:input_tokens] },
            total_output_tokens: calls.sum { |c| c[:output_tokens] },
            total_tokens:        calls.sum { |c| c[:total_tokens] },
            total_cost_usd:      calls.sum { |c| c[:estimated_cost_usd] }.round(6),
            models:              calls.map { |c| c[:model] }.tally,
          }
        end

        OperationalStatus.record!(
          category: "metrics",
          key: "ai_usage",
          payload: {
            services:       services,
            total_cost_usd: services.sum { |s| s[:total_cost_usd] }.round(6),
            recorded_at:    Time.current.iso8601,
          }
        )
      end

      def persist_circuit_breaker_status!
        snapshot = Ai::CircuitBreaker.status_snapshot
        any_open = snapshot.values.any? { |s| s[:status] == "open" }

        OperationalStatus.record!(
          category: "metrics",
          key: "ai_circuit_breakers",
          payload: {
            services: snapshot,
            any_open: any_open,
            recorded_at: Time.current.iso8601,
          }
        )
      end

      def percentile(sorted_array, pct)
        return 0 if sorted_array.empty?
        idx = (pct / 100.0 * (sorted_array.size - 1)).ceil
        sorted_array[idx]&.round(1) || 0
      end
    end

    # Class-level initialization
    @request_samples = {}
    @request_samples_mutex = Mutex.new
    @ai_samples = {}
    @ai_samples_mutex = Mutex.new
    @ai_usage = {}
    @ai_usage_mutex = Mutex.new
  end
end
