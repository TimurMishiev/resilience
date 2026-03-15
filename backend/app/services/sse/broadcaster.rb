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

    # Push a message to all connected clients.
    # event  - SSE event name string (e.g. "task_updated")
    # data   - Hash that will be serialised to JSON
    def publish(event:, data: {})
      payload = { event: event, data: data }.to_json
      @mutex.synchronize do
        @clients.each { |q| q << payload rescue nil }
      end
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end
  end
end
