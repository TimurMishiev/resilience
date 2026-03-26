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
      subscriber_count = @mutex.synchronize do
        @clients << queue
        @clients.size
      end
      Rails.logger.info(
        "[Signals] subscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_capacity=#{MAX_QUEUE_SIZE}"
      )
      queue
    end

    def unsubscribe(queue)
      subscriber_count = @mutex.synchronize do
        @clients.delete(queue)
        @clients.size
      end
      queue.close unless queue.closed?
      Rails.logger.info(
        "[Signals] unsubscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_closed=#{queue.closed?}"
      )
    end

    def publish(signal_payload)
      payload = signal_payload.to_json
      dropped = []

      @mutex.synchronize do
        @clients.each do |queue|
          begin
            queue.push(payload, true)
          rescue ThreadError
            Rails.logger.warn(
              "[Signals] evict_slow_client client=#{queue.object_id} queue_size=#{queue.size} " \
              "queue_capacity=#{MAX_QUEUE_SIZE} subscribers=#{@clients.size}"
            )
            queue.close unless queue.closed?
            dropped << queue
          rescue ClosedQueueError
            dropped << queue
          rescue StandardError => e
            Rails.logger.error(
              "[Signals] publish_error client=#{queue.object_id} error=#{e.class} " \
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
