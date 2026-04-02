module Realtime
  class RelayHealthRegistry
    CATEGORY = "relay_health"
    STALE_AFTER_SECONDS = 65

    class << self
      def record_heartbeat(channel:, relay:, last_notify_at: nil)
        now = Time.current

        OperationalStatus.record!(
          category: CATEGORY,
          key: key_for(channel:, relay:),
          payload: {
            status: "ok",
            relay: relay.to_s,
            channel: channel.to_s,
            last_seen_at: now.iso8601(3),
            last_notify_at: last_notify_at&.iso8601(3),
            heartbeat_expires_at: (now + STALE_AFTER_SECONDS.seconds).iso8601(3),
          }.compact,
        )
      end

      def record_error(channel:, relay:, error:, last_notify_at: nil)
        now = Time.current

        OperationalStatus.record!(
          category: CATEGORY,
          key: key_for(channel:, relay:),
          payload: {
            status: "error",
            relay: relay.to_s,
            channel: channel.to_s,
            last_seen_at: now.iso8601(3),
            last_notify_at: last_notify_at&.iso8601(3),
            last_error_at: now.iso8601(3),
            error_class: error.class.name,
            error_message: error.message.to_s,
            heartbeat_expires_at: now.iso8601(3),
          }.compact,
        )
      end

      private

      def key_for(channel:, relay:)
        "#{relay}:#{channel}"
      end
    end
  end
end
