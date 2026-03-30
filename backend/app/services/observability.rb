module Observability
  DEFAULT_THROTTLE_SECONDS = 60

  class << self
    def enabled?
      defined?(Sentry) && Sentry.initialized?
    end

    def capture_exception(exception, tags: {}, extra: {}, fingerprint: nil, throttle_key: nil, throttle_seconds: DEFAULT_THROTTLE_SECONDS)
      return unless enabled?
      return if throttled?(throttle_key, throttle_seconds)

      with_scope(tags:, extra:, fingerprint:) do
        Sentry.capture_exception(exception)
      end
    end

    def capture_message(message, level: :error, tags: {}, extra: {}, fingerprint: nil, throttle_key: nil, throttle_seconds: DEFAULT_THROTTLE_SECONDS)
      return unless enabled?
      return if throttled?(throttle_key, throttle_seconds)

      with_scope(tags:, extra:, fingerprint:) do
        Sentry.capture_message(message, level: level)
      end
    end

    def reset_throttle_state!
      throttle_mutex.synchronize { throttled_at.clear }
    end

    private

    def with_scope(tags:, extra:, fingerprint:)
      Sentry.with_scope do |scope|
        scope.set_tags(tags.transform_keys(&:to_s)) if tags.present?
        scope.set_extras(extra.transform_keys(&:to_s)) if extra.present?
        scope.fingerprint = Array(fingerprint).map(&:to_s) if fingerprint.present?
        yield
      end
    end

    def throttled?(key, seconds)
      return false if key.blank? || seconds.to_i <= 0

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)

      throttle_mutex.synchronize do
        last_sent_at = throttled_at[key]
        if last_sent_at && (now - last_sent_at) < seconds.to_f
          true
        else
          throttled_at[key] = now
          false
        end
      end
    end

    def throttled_at
      @throttled_at ||= {}
    end

    def throttle_mutex
      @throttle_mutex ||= Mutex.new
    end
  end
end
