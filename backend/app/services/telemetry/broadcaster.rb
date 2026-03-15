require "singleton"

module Telemetry
  # Thread-safe pub/sub broadcaster for asset telemetry readings.
  # Follows the same Singleton/Mutex/Queue pattern as Sse::Broadcaster.
  class Broadcaster
    include Singleton

    def initialize
      @mutex   = Mutex.new
      @clients = []
    end

    # Subscribe a new client. Returns a Queue the caller pops from.
    def subscribe
      queue = Queue.new
      @mutex.synchronize { @clients << queue }
      queue
    end

    # Remove a client's queue (call in ensure block).
    def unsubscribe(queue)
      @mutex.synchronize { @clients.delete(queue) }
    end

    # Publish a telemetry snapshot to all connected clients.
    # Each reading is a Hash: { asset_id:, lat:, lng:, battery:, speed:, heading:, ts: }
    def publish(reading)
      payload = reading.to_json
      @mutex.synchronize do
        @clients.each { |q| q << payload rescue nil }
      end
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end
  end
end
