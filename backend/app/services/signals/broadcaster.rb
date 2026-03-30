require "singleton"
require "securerandom"

module Signals
  class Broadcaster
    include Singleton

    MAX_QUEUE_SIZE = 200
    RELAY_CHANNEL = "resilience_signals"
    MAX_NOTIFY_BYTES = 7_500

    def initialize
      @mutex   = Mutex.new
      @clients = []
      @relay_instance_id = SecureRandom.uuid
      @relay_listener = nil
      @relay_mutex = Mutex.new
    end

    def subscribe
      ensure_relay_listener!
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
      deliver_payload(payload)
      publish_relay_payload(signal_payload, payload)
    end

    def subscriber_count
      @mutex.synchronize { @clients.size }
    end

    private

    def ensure_relay_listener!
      return if Rails.env.test?

      @relay_mutex.synchronize do
        return if @relay_listener&.alive?

        @relay_listener = Realtime::PostgresRelay.listen(channel: RELAY_CHANNEL, logger_prefix: "Signals") do |payload|
          handle_relay_payload(payload)
        end
      end
    end

    def publish_relay_payload(signal_payload, serialized_payload)
      relay_payload =
        if serialized_payload.bytesize <= MAX_NOTIFY_BYTES
          { origin: @relay_instance_id, payload: signal_payload }
        else
          signal_id = signal_payload["id"] || signal_payload[:id]
          return unless signal_id

          { origin: @relay_instance_id, signal_id: signal_id }
        end

      Realtime::PostgresRelay.publish(channel: RELAY_CHANNEL, payload: relay_payload.to_json)
    end

    def handle_relay_payload(payload)
      parsed = JSON.parse(payload)
      return if parsed["origin"] == @relay_instance_id

      if parsed["payload"]
        deliver_payload(parsed["payload"].to_json)
      elsif parsed["signal_id"]
        signal = ExternalSignal.find_by(id: parsed["signal_id"])
        deliver_payload(Signals::PayloadSerializer.call(signal).to_json) if signal
      end
    rescue JSON::ParserError, KeyError => e
      Rails.logger.error("[Signals] relay_payload_error error=#{e.class} message=#{e.message}")
    end

    def deliver_payload(payload)
      snapshot = @mutex.synchronize { @clients.dup }
      dropped  = []

      snapshot.each do |queue|
        begin
          queue.push(payload, true)
        rescue ThreadError
          Rails.logger.warn(
            "[Signals] evict_slow_client client=#{queue.object_id} queue_size=#{queue.size} " \
            "queue_capacity=#{MAX_QUEUE_SIZE} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << queue
        rescue ClosedQueueError
          dropped << queue
        rescue StandardError => e
          Rails.logger.error(
            "[Signals] publish_error client=#{queue.object_id} error=#{e.class} " \
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
