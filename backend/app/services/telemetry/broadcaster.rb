require "singleton"

module Telemetry
  # Thread-safe pub/sub broadcaster for asset telemetry readings.
  # Follows the same Singleton/Mutex/Queue pattern as Sse::Broadcaster.
  class Broadcaster
    include Singleton

    MAX_QUEUE_SIZE = 200

    def initialize
      @mutex   = Mutex.new
      @clients = []
    end

    # Subscribe a new client. Returns a bounded queue the caller pops from.
    def subscribe
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
      dropped = []

      @mutex.synchronize do
        @clients.each do |queue|
          begin
            queue.push(payload, true)
          rescue ThreadError
            Rails.logger.warn(
              "[Telemetry] evict_slow_client client=#{queue.object_id} queue_size=#{queue.size} " \
              "queue_capacity=#{MAX_QUEUE_SIZE} subscribers=#{@clients.size}"
            )
            queue.close unless queue.closed?
            dropped << queue
          rescue ClosedQueueError
            dropped << queue
          rescue StandardError => e
            Rails.logger.error(
              "[Telemetry] publish_error client=#{queue.object_id} error=#{e.class} " \
              "message=#{e.message} subscribers=#{@clients.size}"
            )
            queue.close unless queue.closed?
            dropped << queue
          end
        end

        @clients -= dropped unless dropped.empty?
      end
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end
  end
end
