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
      @mutex.synchronize { @clients << queue }
      queue
    end

    # Remove a client's queue (call in ensure block).
    def unsubscribe(queue)
      @mutex.synchronize { @clients.delete(queue) }
      queue.close unless queue.closed?
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
            Rails.logger.warn("[Telemetry] evicting slow client — queue at capacity #{MAX_QUEUE_SIZE}")
            queue.close unless queue.closed?
            dropped << queue
          rescue ClosedQueueError
            dropped << queue
          rescue StandardError => e
            Rails.logger.error("[Telemetry] publish error: #{e.message}")
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
