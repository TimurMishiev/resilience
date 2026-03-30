require "singleton"
require "securerandom"

module Telemetry
  # Thread-safe pub/sub broadcaster for asset telemetry readings.
  # Follows the same Singleton/Mutex/Queue pattern as Sse::Broadcaster.
  class Broadcaster
    include Singleton

    MAX_QUEUE_SIZE = 200
    RELAY_CHANNEL = "resilience_telemetry"

    def initialize
      @mutex   = Mutex.new
      @clients = []
      @relay_instance_id = SecureRandom.uuid
      @relay_listener = nil
      @relay_mutex = Mutex.new
    end

    # Subscribe a new client. Returns a bounded queue the caller pops from.
    def subscribe
      ensure_relay_listener!
      queue = SizedQueue.new(MAX_QUEUE_SIZE)
      subscriber_count = @mutex.synchronize do
        @clients << queue
        @clients.size
      end
      Rails.logger.info(
        "[Telemetry] subscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_capacity=#{MAX_QUEUE_SIZE}"
      )
      queue
    end

    # Remove a client's queue (call in ensure block).
    def unsubscribe(queue)
      subscriber_count = @mutex.synchronize do
        @clients.delete(queue)
        @clients.size
      end
      queue.close unless queue.closed?
      Rails.logger.info(
        "[Telemetry] unsubscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_closed=#{queue.closed?}"
      )
    end

    # Publish a telemetry snapshot to all connected clients.
    # Each reading is a Hash: { asset_id:, lat:, lng:, battery:, speed:, heading:, ts: }
    def publish(reading)
      payload = reading.to_json
      relay_payload = { origin: @relay_instance_id, reading: reading }.to_json

      deliver_payload(payload)
      Realtime::PostgresRelay.publish(channel: RELAY_CHANNEL, payload: relay_payload)
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end

    private

    def ensure_relay_listener!
      return if Rails.env.test?

      @relay_mutex.synchronize do
        return if @relay_listener&.alive?

        @relay_listener = Realtime::PostgresRelay.listen(channel: RELAY_CHANNEL, logger_prefix: "Telemetry") do |payload|
          handle_relay_payload(payload)
        end
      end
    end

    def handle_relay_payload(payload)
      parsed = JSON.parse(payload)
      return if parsed["origin"] == @relay_instance_id

      deliver_payload(parsed.fetch("reading").to_json)
    rescue JSON::ParserError, KeyError => e
      Rails.logger.error("[Telemetry] relay_payload_error error=#{e.class} message=#{e.message}")
    end

    def deliver_payload(payload)
      snapshot = @mutex.synchronize { @clients.dup }
      dropped  = []

      snapshot.each do |queue|
        begin
          queue.push(payload, true)
        rescue ThreadError
          Rails.logger.warn(
            "[Telemetry] evict_slow_client client=#{queue.object_id} queue_size=#{queue.size} " \
            "queue_capacity=#{MAX_QUEUE_SIZE} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << queue
        rescue ClosedQueueError
          dropped << queue
        rescue StandardError => e
          Rails.logger.error(
            "[Telemetry] publish_error client=#{queue.object_id} error=#{e.class} " \
            "message=#{e.message} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << queue
        end
      end

      @mutex.synchronize { @clients -= dropped } unless dropped.empty?
    end
  end
end
