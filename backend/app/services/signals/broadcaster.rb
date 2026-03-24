require "singleton"

module Signals
  class Broadcaster
    include Singleton

    def initialize
      @mutex   = Mutex.new
      @clients = []
    end

    def subscribe
      queue = Queue.new
      @mutex.synchronize { @clients << queue }
      queue
    end

    def unsubscribe(queue)
      @mutex.synchronize { @clients.delete(queue) }
    end

    def publish(signal_payload)
      payload = signal_payload.to_json
      @mutex.synchronize do
        @clients.each { |queue| queue << payload rescue nil }
      end
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end
  end
end
