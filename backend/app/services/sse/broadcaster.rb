module Sse
  # Thread-safe pub/sub broadcaster for SSE connections.
  # Each connected client registers a Queue. On publish, every
  # registered queue receives the message. On disconnect the
  # queue is removed.
  class Broadcaster
    include Singleton

    def initialize
      @mutex   = Mutex.new
      @clients = []
    end

    # Register a new client queue. Returns the queue.
    def subscribe
      queue = Queue.new
      @mutex.synchronize { @clients << queue }
      queue
    end

    # Remove a client queue (called on disconnect).
    def unsubscribe(queue)
      @mutex.synchronize { @clients.delete(queue) }
    end

    # Maximum number of unread messages allowed in a single client's queue.
    # A slow/buffered client that exceeds this is evicted — it will reconnect
    # via EventSource's automatic retry rather than stalling all other clients.
    MAX_QUEUE_SIZE = 500

    # Push a message to all connected clients.
    # event  - SSE event name string (e.g. "task_updated")
    # data   - Hash that will be serialised to JSON
    def publish(event:, data: {})
      payload = { event: event, data: data }.to_json
      dropped = []

      @mutex.synchronize do
        @clients.each do |q|
          if q.size >= MAX_QUEUE_SIZE
            Rails.logger.warn(
              "[SSE] evicting slow client — queue at #{q.size} (event=#{event})"
            )
            dropped << q
          else
            begin
              q << payload
            rescue ClosedQueueError
              dropped << q
            rescue => e
              Rails.logger.error("[SSE] publish error (event=#{event}): #{e.message}")
              dropped << q
            end
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
