require "singleton"
require "securerandom"

module Sse
  # Thread-safe pub/sub broadcaster for SSE connections.
  # Each connected client registers a Queue. On publish, every
  # registered queue receives the message. On disconnect the
  # queue is removed.
  class Broadcaster
    include Singleton

    RELAY_CHANNEL = "resilience_sse_events"

    def initialize
      @mutex   = Mutex.new
      @clients = []
      @relay_instance_id = SecureRandom.uuid
      @relay_listener = nil
      @relay_mutex = Mutex.new
    end

    # Register a new client queue. Returns the queue.
    def subscribe
      ensure_relay_listener!
      queue = Queue.new
      subscriber_count = @mutex.synchronize do
        @clients << queue
        @clients.size
      end
      Rails.logger.info(
        "[SSE] subscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_capacity=#{MAX_QUEUE_SIZE}"
      )
      queue
    end

    # Remove a client queue (called on disconnect).
    def unsubscribe(queue)
      subscriber_count = @mutex.synchronize do
        @clients.delete(queue)
        @clients.size
      end
      queue.close unless queue.closed?
      Rails.logger.info(
        "[SSE] unsubscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_closed=#{queue.closed?}"
      )
    end

    # Maximum number of unread messages allowed in a single client's queue.
    # A slow/buffered client that exceeds this is evicted — it will reconnect
    # via EventSource's automatic retry rather than stalling all other clients.
    MAX_QUEUE_SIZE = 500

    # Push a message to all connected clients.
    # organization_id - optional UUID; when present, EventsController will
    #   only deliver the event to clients whose user belongs to the same org
    #   (or to users with no org — i.e. unrestricted users).
    def publish(event:, data: {}, organization_id: nil)
      payload = { event: event, data: data, organization_id: organization_id }.to_json
      relay_payload = { origin: @relay_instance_id, event: event, data: data, organization_id: organization_id }.to_json

      # Snapshot under lock — O(n) array dup, no I/O.
      deliver_payload(payload, event: event)
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

        @relay_listener = Realtime::PostgresRelay.listen(channel: RELAY_CHANNEL, logger_prefix: "SSE") do |payload|
          handle_relay_payload(payload)
        end
      end
    end

    def handle_relay_payload(payload)
      parsed = JSON.parse(payload)
      return if parsed["origin"] == @relay_instance_id

      deliver_payload({ event: parsed.fetch("event"), data: parsed["data"], organization_id: parsed["organization_id"] }.to_json, event: parsed["event"])
    rescue JSON::ParserError, KeyError => e
      Rails.logger.error("[SSE] relay_payload_error error=#{e.class} message=#{e.message}")
    end

    def deliver_payload(payload, event:)
      snapshot = @mutex.synchronize { @clients.dup }

      dropped = []
      snapshot.each do |q|
        if q.size >= MAX_QUEUE_SIZE
          Rails.logger.warn(
            "[SSE] evict_slow_client client=#{q.object_id} event=#{event} queue_size=#{q.size} " \
            "queue_capacity=#{MAX_QUEUE_SIZE} snapshot_subscribers=#{snapshot.size}"
          )
          q.close unless q.closed?
          dropped << q
        else
          begin
            q << payload
          rescue ClosedQueueError
            dropped << q
          rescue => e
            Rails.logger.error(
              "[SSE] publish_error client=#{q.object_id} event=#{event} error=#{e.class} " \
              "message=#{e.message}"
            )
            q.close unless q.closed?
            dropped << q
          end
        end
      end

      @mutex.synchronize { @clients -= dropped } unless dropped.empty?
    end
  end
end
