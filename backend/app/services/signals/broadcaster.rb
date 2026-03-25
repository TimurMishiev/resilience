require "singleton"

module Signals
  class Broadcaster
    include Singleton

    MAX_QUEUE_SIZE = 200

    def initialize
      @mutex   = Mutex.new
      @clients = []
    end

    def subscribe
      queue = SizedQueue.new(MAX_QUEUE_SIZE)
      @mutex.synchronize { @clients << queue }
      queue
    end

    def unsubscribe(queue)
      @mutex.synchronize { @clients.delete(queue) }
      queue.close unless queue.closed?
    end

    def publish(signal_payload)
      payload = signal_payload.to_json
      dropped = []

      @mutex.synchronize do
        @clients.each do |queue|
          begin
            queue.push(payload, true)
          rescue ThreadError
            Rails.logger.warn("[Signals] evicting slow client — queue at capacity #{MAX_QUEUE_SIZE}")
            queue.close unless queue.closed?
            dropped << queue
          rescue ClosedQueueError
            dropped << queue
          rescue StandardError => e
            Rails.logger.error("[Signals] publish error: #{e.message}")
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
