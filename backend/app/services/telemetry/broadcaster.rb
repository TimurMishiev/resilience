require "singleton"
require "securerandom"
require "set"

module Telemetry
  # Thread-safe pub/sub broadcaster for asset telemetry readings.
  # Follows the same Singleton/Mutex/Queue pattern as Sse::Broadcaster,
  # but adds tenant-scoped routing: each subscriber registers a frozen
  # Set of allowed asset_ids (or the :all sentinel for unrestricted
  # admins), and publish only delivers readings the subscriber is
  # allowed to see.
  #
  # Why routing matters: the previous design fanned every reading out
  # to every connected client's queue and relied on the consuming
  # SSE controller to JSON-parse and filter per-payload. At ~1k
  # signals/sec across 100 clients, that's 100k JSON parses/sec
  # discarded — catastrophic CPU/GC pressure in one Ruby process.
  # Routing here moves the visibility check to the producer side
  # where the asset_id is a Hash key away.
  #
  # The TelemetryController still keeps its per-payload visibility
  # filter as defence-in-depth: the broadcaster's filter is updated
  # only every 30 s (during the controller's policy_scope refresh),
  # so a revocation in the in-between window must still be caught
  # before the payload is forwarded to the client.
  class Broadcaster
    include Singleton

    MAX_QUEUE_SIZE = 200
    RELAY_CHANNEL = "resilience_telemetry"

    # A subscription pairs a queue with an atomic-but-reassignable
    # asset_ids filter. The filter is replaced as a whole reference,
    # never mutated in place — readers see either the old frozen Set
    # or the new one, never a torn read.
    class Subscription
      attr_reader :queue

      def initialize(queue:, asset_ids:)
        @queue = queue
        @asset_ids = normalise(asset_ids)
      end

      def matches?(asset_id)
        ids = @asset_ids
        return true if ids == :all
        ids.include?(asset_id)
      end

      def update_asset_ids(asset_ids)
        @asset_ids = normalise(asset_ids)
      end

      def asset_ids
        @asset_ids
      end

      private

      def normalise(asset_ids)
        return :all if asset_ids == :all
        Set.new(asset_ids).freeze
      end
    end

    def initialize
      @mutex   = Mutex.new
      @subscribers = []
      @relay_instance_id = SecureRandom.uuid
      @relay_listener = nil
      @relay_mutex = Mutex.new
    end

    # Subscribe a new client.
    #
    # asset_ids: either an Array/Set of asset UUIDs the subscriber is
    # allowed to receive, or :all for unrestricted (admin/no-tenant)
    # viewers. Defaults to :all so any caller migrating from the
    # previous (asset_ids-less) signature retains the prior fan-out
    # behaviour until updated.
    #
    # Returns the bounded Queue the caller pops from. The caller can
    # later call #update_subscription(queue, asset_ids:) to refresh
    # the filter set as their policy_scope changes mid-stream.
    def subscribe(asset_ids: :all)
      ensure_relay_listener!
      queue = SizedQueue.new(MAX_QUEUE_SIZE)
      subscription = Subscription.new(queue: queue, asset_ids: asset_ids)
      subscriber_count = @mutex.synchronize do
        @subscribers << subscription
        @subscribers.size
      end
      Rails.logger.info(
        "[Telemetry] subscribe client=#{queue.object_id} subscribers=#{subscriber_count} " \
        "queue_capacity=#{MAX_QUEUE_SIZE} scope=#{asset_ids == :all ? 'unrestricted' : asset_ids.size}"
      )
      queue
    end

    # Update an existing subscription's filter. The TelemetryController
    # calls this every ALLOWED_ASSETS_REFRESH_SECONDS so revocations
    # take effect at the broadcaster layer — without this, a revoked
    # operator would continue receiving every payload (even if their
    # controller filter dropped it locally; the wasted JSON-push to
    # their queue is the cost we are eliminating).
    def update_subscription(queue, asset_ids:)
      @mutex.synchronize do
        sub = @subscribers.find { |s| s.queue.equal?(queue) }
        sub&.update_asset_ids(asset_ids)
      end
    end

    # Remove a subscription (call in ensure block).
    def unsubscribe(queue)
      subscriber_count = @mutex.synchronize do
        @subscribers.delete_if { |s| s.queue.equal?(queue) }
        @subscribers.size
      end
      queue.close unless queue.closed?
      Rails.logger.info(
        "[Telemetry] unsubscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_closed=#{queue.closed?}"
      )
    end

    # Publish a telemetry snapshot. Only delivers to subscribers whose
    # asset_ids filter includes reading[:asset_id] (or who subscribed
    # with :all). Cross-machine relay still goes out unconditionally —
    # remote machines apply their own subscriber-side filter.
    def publish(reading)
      asset_id = reading[:asset_id] || reading["asset_id"]
      payload = reading.to_json
      relay_payload = { origin: @relay_instance_id, reading: reading }.to_json

      deliver_payload(payload, asset_id: asset_id)
      Realtime::PostgresRelay.publish(channel: RELAY_CHANNEL, payload: relay_payload)
    end

    def subscriber_count
      @mutex.synchronize { @subscribers.size }
    end

    private

    def ensure_relay_listener!
      return if Rails.env.test?

      @relay_mutex.synchronize do
        return if @relay_listener&.alive?

        @relay_listener = Realtime::PostgresRelay.listen(channel: RELAY_CHANNEL, logger_prefix: "Telemetry") do |payload|
          handle_relay_payload(payload)
        end
      end
    end

    def handle_relay_payload(payload)
      parsed = JSON.parse(payload)
      return if parsed["origin"] == @relay_instance_id

      reading = parsed.fetch("reading")
      asset_id = reading.is_a?(Hash) ? (reading["asset_id"] || reading[:asset_id]) : nil
      deliver_payload(reading.to_json, asset_id: asset_id)
    rescue JSON::ParserError, KeyError => e
      Rails.logger.error("[Telemetry] relay_payload_error error=#{e.class} message=#{e.message}")
    end

    def deliver_payload(payload, asset_id:)
      snapshot = @mutex.synchronize { @subscribers.dup }
      dropped  = []

      snapshot.each do |subscription|
        # Tenant routing: skip subscribers whose asset_ids filter does
        # not include this reading's asset. The previous design pushed
        # to every queue and let the controller filter — this avoids
        # the wasted push entirely.
        next unless subscription.matches?(asset_id)

        queue = subscription.queue
        begin
          queue.push(payload, true)
        rescue ThreadError
          Rails.logger.warn(
            "[Telemetry] evict_slow_client client=#{queue.object_id} queue_size=#{queue.size} " \
            "queue_capacity=#{MAX_QUEUE_SIZE} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << subscription
        rescue ClosedQueueError
          dropped << subscription
        rescue StandardError => e
          Rails.logger.error(
            "[Telemetry] publish_error client=#{queue.object_id} error=#{e.class} " \
            "message=#{e.message} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << subscription
        end
      end

      @mutex.synchronize { @subscribers -= dropped } unless dropped.empty?
    end
  end
end
