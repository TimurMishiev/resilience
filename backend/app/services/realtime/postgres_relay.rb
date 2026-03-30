module Realtime
  class PostgresRelay
    RECONNECT_DELAY_SECONDS = 1

    class << self
      def publish(channel:, payload:)
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          connection.raw_connection.exec_params(
            "SELECT pg_notify($1, $2)",
            [channel.to_s, payload.to_s]
          )
        end
      end

      def listen(channel:, logger_prefix:, &block)
        Thread.new do
          Thread.current.name = "#{logger_prefix.downcase.tr(' ', '-')}-relay"
          Thread.current.abort_on_exception = false

          loop do
            connection = nil

            begin
              connection = build_listener_connection
              connection.exec("LISTEN #{PG::Connection.quote_ident(channel.to_s)}")

              loop do
                connection.wait_for_notify(30) do |_event, _pid, payload|
                  yield payload
                end
              end
            rescue PG::Error, IOError => e
              Rails.logger.error(
                "[#{logger_prefix}] relay_error channel=#{channel} error=#{e.class} message=#{e.message}"
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
