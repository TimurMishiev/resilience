module Realtime
  class PostgresRelay
    RECONNECT_DELAY_SECONDS = 1

    # Postgres' NOTIFY command has a hard payload limit of 8000 bytes; a
    # call with a larger payload raises PG::InvalidParameterValue at
    # runtime (it is NOT silently dropped, but the failure happens deep
    # inside a publishing path that the rest of the system treats as
    # fire-and-forget — without an explicit guard, rule-fire SSE events
    # carrying unusually-large metadata could intermittently fail to
    # reach other Fly machines while logs only show the exception class).
    #
    # The published payloads we send today (telemetry readings, SSE event
    # envelopes) are far below this ceiling, but we add a guard so:
    #   - oversize payloads are rejected at publish time with a clear
    #     log line naming the channel and size,
    #   - the in-process subscribers still receive the payload (so the
    #     local UI does not silently miss an event),
    #   - cross-machine relay is skipped for that one payload only.
    NOTIFY_PAYLOAD_BYTE_LIMIT = 7_900

    class << self
      def publish(channel:, payload:)
        payload_str = payload.to_s
        if payload_str.bytesize > NOTIFY_PAYLOAD_BYTE_LIMIT
          Rails.logger.error(
            "[PostgresRelay] payload too large for NOTIFY channel=#{channel} " \
            "bytesize=#{payload_str.bytesize} limit=#{NOTIFY_PAYLOAD_BYTE_LIMIT} — skipping cross-machine relay"
          )
          Observability.capture_exception(
            ArgumentError.new("NOTIFY payload exceeds 7900-byte safety cap"),
            tags: { component: "postgres_relay", channel: channel.to_s },
            extra: { bytesize: payload_str.bytesize, limit: NOTIFY_PAYLOAD_BYTE_LIMIT },
            throttle_key: "postgres_relay_payload_too_large:#{channel}",
            throttle_seconds: 300,
          )
          return false
        end

        ActiveRecord::Base.connection_pool.with_connection do |connection|
          connection.raw_connection.exec_params(
            "SELECT pg_notify($1, $2)",
            [channel.to_s, payload_str]
          )
        end
        true
      end

      def listen(channel:, logger_prefix:, &block)
        Thread.new do
          relay_name = logger_prefix.downcase.tr(" ", "_")

          Thread.current.name = "#{relay_name.tr('_', '-')}-relay"
          Thread.current.abort_on_exception = false
          last_notify_at = nil

          loop do
            connection = nil

            begin
              connection = build_listener_connection
              connection.exec("LISTEN #{PG::Connection.quote_ident(channel.to_s)}")
              Realtime::RelayHealthRegistry.record_heartbeat(
                channel: channel,
                relay: relay_name,
                last_notify_at: last_notify_at,
              )

              loop do
                connection.wait_for_notify(30) do |_event, _pid, payload|
                  last_notify_at = Time.current
                  Realtime::RelayHealthRegistry.record_heartbeat(
                    channel: channel,
                    relay: relay_name,
                    last_notify_at: last_notify_at,
                  )
                  yield payload
                end
                Realtime::RelayHealthRegistry.record_heartbeat(
                  channel: channel,
                  relay: relay_name,
                  last_notify_at: last_notify_at,
                )
              end
            rescue PG::Error, IOError => e
              Realtime::RelayHealthRegistry.record_error(
                channel: channel,
                relay: relay_name,
                error: e,
                last_notify_at: last_notify_at,
              )
              Rails.logger.error(
                "[#{logger_prefix}] relay_error channel=#{channel} error=#{e.class} message=#{e.message}"
              )
              Observability.capture_exception(
                e,
                tags: { component: "postgres_relay", channel: channel, relay: relay_name },
                throttle_key: "postgres_relay:#{channel}:#{e.class}",
                throttle_seconds: 60
              )
              sleep RECONNECT_DELAY_SECONDS
            rescue StandardError => e
              Realtime::RelayHealthRegistry.record_error(
                channel: channel,
                relay: relay_name,
                error: e,
                last_notify_at: last_notify_at,
              )
              Rails.logger.error(
                "[#{logger_prefix}] relay_unexpected_error channel=#{channel} error=#{e.class} message=#{e.message}"
              )
              Observability.capture_exception(
                e,
                tags: { component: "postgres_relay", channel: channel, relay: relay_name },
                throttle_key: "postgres_relay_unexpected:#{channel}:#{e.class}",
                throttle_seconds: 60
              )
              sleep RECONNECT_DELAY_SECONDS
            ensure
              begin
                connection&.close
              rescue PG::Error, IOError
                nil
              end
            end
          end
        end
      end

      private

      def build_listener_connection
        PG.connect(listener_connection_params)
      end

      def listener_connection_params
        config = ActiveRecord::Base.connection_db_config.configuration_hash.symbolize_keys

        {}.tap do |params|
          params[:host] = config[:host] if config[:host].present?
          params[:port] = config[:port] if config[:port].present?
          params[:dbname] = config[:database] || config[:dbname]
          params[:user] = config[:username] || config[:user] if (config[:username] || config[:user]).present?
          params[:password] = config[:password] if config[:password].present?
          params[:sslmode] = config[:sslmode] if config[:sslmode].present?
        end
      end
    end
  end
end
