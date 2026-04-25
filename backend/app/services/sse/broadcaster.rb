require "singleton"
require "securerandom"

module Sse
  # Thread-safe pub/sub broadcaster for SSE connections.
  #
  # Each connected client registers a Subscription that pairs a bounded
  # queue with the subscriber's tenant scope (organization_id +
  # area_of_operation_id). On publish, only subscribers whose scope
  # admits the event's organization_id receive the payload — the
  # producer-side filter mirrors Telemetry::Broadcaster's pattern and
  # eliminates the wasted push to clients that would have dropped the
  # event in their consumer-side filter anyway.
  #
  # WHY tenant routing matters here: at moderate event volume across
  # 50+ concurrent operators, the previous design fanned every event
  # out to every queue and relied on EventsController to JSON-parse +
  # filter per-payload. That's O(events × subscribers) JSON parses of
  # discarded payloads — wasted CPU/GC pressure proportional to the
  # cross-tenant subscriber count. Producer-side filtering cuts that
  # to O(events × matching_subscribers).
  #
  # Filtering rules (mirrors EventsController#event_visible_to_scope?):
  #
  #   - Subscribers with organization_id = nil are unrestricted (admin
  #     view) — every event matches.
  #   - Events with organization_id = nil are global — match every
  #     subscriber.
  #   - Otherwise: subscriber.organization_id must equal
  #     event.organization_id for the event to deliver.
  #
  # Area-of-operation filtering stays on the consumer side
  # (EventsController#event_visible_to_scope?). AO is not always
  # carried on the publish payload — many events carry data.site_id
  # and the controller resolves site → AO lazily via a per-stream
  # cache. Pushing AO resolution to producer side would require
  # touching every publisher to do the lookup at publish time. The
  # current split is honest: cheap producer-side filter for the
  # dominant axis (org), lazy consumer-side filter for AO.
  #
  # The consumer-side filter in EventsController also serves as
  # defence-in-depth — Subscription#scope is updated only when the
  # caller explicitly refreshes it (e.g. on session/role change), so
  # a revocation that has not yet propagated to the broadcaster is
  # still caught at consume time.
  class Broadcaster
    include Singleton

    RELAY_CHANNEL = "resilience_sse_events"

    # Maximum number of unread messages allowed in a single client's queue.
    # A slow/buffered client that exceeds this is evicted — it will reconnect
    # via EventSource's automatic retry rather than stalling all other clients.
    MAX_QUEUE_SIZE = 500

    # A subscription pairs a queue with a frozen tenant scope.
    # Reassignable via #update_scope so a re-authenticated stream can
    # propagate revocations without re-subscribing. Reads are atomic at
    # the reference level — readers see either the old frozen scope or
    # the new one, never a torn read.
    class Subscription
      attr_reader :queue

      def initialize(queue:, organization_id:)
        @queue = queue
        @scope = build_scope(organization_id)
      end

      def matches?(event_organization_id)
        scope = @scope
        # Unrestricted subscriber (admin / no tenant) — every event matches.
        return true if scope[:organization_id].nil?
        # Global event (no org_id) — every subscriber sees it.
        return true if event_organization_id.nil?
        scope[:organization_id] == event_organization_id
      end

      def update_scope(organization_id:)
        @scope = build_scope(organization_id)
      end

      def organization_id
        @scope[:organization_id]
      end

      private

      def build_scope(organization_id)
        { organization_id: organization_id }.freeze
      end
    end

    def initialize
      @mutex   = Mutex.new
      @subscribers = []
      @relay_instance_id = SecureRandom.uuid
      @relay_listener = nil
      @relay_mutex = Mutex.new
    end

    # Register a new client.
    #
    # organization_id: the subscribing user's organization_id, or nil
    # for unrestricted (admin / no-tenant) subscribers. The broadcaster
    # uses this for producer-side scope matching on publish.
    #
    # Returns the bounded Queue the caller pops from.
    def subscribe(organization_id: nil)
      ensure_relay_listener!
      queue = SizedQueue.new(MAX_QUEUE_SIZE)
      subscription = Subscription.new(queue: queue, organization_id: organization_id)
      subscriber_count = @mutex.synchronize do
        @subscribers << subscription
        @subscribers.size
      end
      Rails.logger.info(
        "[SSE] subscribe client=#{queue.object_id} subscribers=#{subscriber_count} " \
        "queue_capacity=#{MAX_QUEUE_SIZE} scope=#{organization_id.nil? ? 'unrestricted' : 'org-scoped'}"
      )
      queue
    end

    # Update an existing subscription's scope. Used when the
    # subscribing user's organization changes mid-stream (rare —
    # typically only on a revocation/admin-action). Without this,
    # such changes would be invisible to the broadcaster until
    # reconnect.
    def update_subscription(queue, organization_id:)
      @mutex.synchronize do
        sub = @subscribers.find { |s| s.queue.equal?(queue) }
        sub&.update_scope(organization_id: organization_id)
      end
    end

    # Remove a client (called on disconnect).
    def unsubscribe(queue)
      subscriber_count = @mutex.synchronize do
        @subscribers.delete_if { |s| s.queue.equal?(queue) }
        @subscribers.size
      end
      queue.close unless queue.closed?
      Rails.logger.info(
        "[SSE] unsubscribe client=#{queue.object_id} subscribers=#{subscriber_count} queue_closed=#{queue.closed?}"
      )
    end

    # Push a message to all matching connected clients.
    # organization_id - optional UUID; subscribers with a different
    #   organization_id will not receive the event. nil means global —
    #   every subscriber sees it.
    def publish(event:, data: {}, organization_id: nil)
      payload = { event: event, data: data, organization_id: organization_id }.to_json
      relay_payload = { origin: @relay_instance_id, event: event, data: data, organization_id: organization_id }.to_json

      deliver_payload(payload, event: event, organization_id: organization_id)
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

        @relay_listener = Realtime::PostgresRelay.listen(channel: RELAY_CHANNEL, logger_prefix: "SSE") do |payload|
          handle_relay_payload(payload)
        end
      end
    end

    def handle_relay_payload(payload)
      parsed = JSON.parse(payload)
      return if parsed["origin"] == @relay_instance_id

      event = parsed.fetch("event")
      organization_id = parsed["organization_id"]
      deliver_payload(
        { event: event, data: parsed["data"], organization_id: organization_id }.to_json,
        event: event,
        organization_id: organization_id,
      )
    rescue JSON::ParserError, KeyError => e
      Rails.logger.error("[SSE] relay_payload_error error=#{e.class} message=#{e.message}")
    end

    def deliver_payload(payload, event:, organization_id:)
      snapshot = @mutex.synchronize { @subscribers.dup }

      dropped = []
      snapshot.each do |subscription|
        # Tenant routing: skip subscribers whose org scope does not
        # match this event's organization_id. The previous design
        # pushed to every queue and let EventsController filter — this
        # avoids the wasted push entirely.
        next unless subscription.matches?(organization_id)

        queue = subscription.queue
        begin
          queue.push(payload, true)
        rescue ThreadError
          Rails.logger.warn(
            "[SSE] evict_slow_client client=#{queue.object_id} event=#{event} queue_size=#{queue.size} " \
            "queue_capacity=#{MAX_QUEUE_SIZE} snapshot_subscribers=#{snapshot.size}"
          )
          queue.close unless queue.closed?
          dropped << subscription
        rescue ClosedQueueError
          dropped << subscription
        rescue StandardError => e
          Rails.logger.error(
            "[SSE] publish_error client=#{queue.object_id} event=#{event} error=#{e.class} " \
            "message=#{e.message}"
          )
          queue.close unless queue.closed?
          dropped << subscription
        end
      end

      @mutex.synchronize { @subscribers -= dropped } unless dropped.empty?
    end
  end
end
