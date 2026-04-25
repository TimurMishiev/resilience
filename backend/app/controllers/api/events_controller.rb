module Api
  class EventsController < ApplicationController
    include ActionController::Live
    include JwtAuthenticatable
    include Pundit::Authorization
    after_action :verify_authorized

    rescue_from Pundit::NotAuthorizedError do |_e|
      render json: { errors: ["Not authorized"] }, status: :forbidden
    end

    # GET /api/events
    # Opens a persistent SSE stream for the authenticated client.
    # The client receives a heartbeat every 25 seconds to keep the
    # connection alive through proxies and load balancers.
    def stream
      authorize :event, :stream?
      lease = admit_sse_stream!(stream_name: "events")
      return unless lease

      response.headers["Content-Type"]  = "text/event-stream"
      response.headers["Cache-Control"] = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      broadcaster = Sse::Broadcaster.instance
      # Producer-side org filter (Tranche 2A, 2026-04-25): the
      # broadcaster matches subscriber.organization_id against
      # event.organization_id at publish time, so cross-tenant events
      # never reach this queue. AO filtering remains consumer-side
      # (event_visible_to_scope? below) — see Sse::Broadcaster comment
      # for the org-vs-AO scope split rationale.
      queue       = broadcaster.subscribe(organization_id: current_user.organization_id)

      # Send an initial connection confirmation event
      return unless sse_write(response.stream, event: "connected", data: { message: "stream open" })

      # Heartbeat thread — keeps the TCP connection alive
      heartbeat = start_sse_heartbeat(stream_name: "events") do
        refresh_sse_stream_lease(lease, stream_name: "events") &&
          sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
      end

      # Block here, draining the queue until the client disconnects.
      # Broadcaster#publish pushes { event:, data: }.to_json — parse that back
      # and re-emit as proper SSE framing so the browser EventSource can match
      # named-event listeners (e.g. addEventListener('task_created', ...)).
      # Raw JSON written directly would arrive as a 'message' event and silently
      # miss every named listener registered in useEventSource.ts.
      user_org_id = current_user.organization_id
      user_ao_id  = current_user.area_of_operation_id
      site_area_cache = {}

      # Release the controller-action's checked-out DB connection before
      # entering the blocking loop. Without this, ActionController::Live
      # holds the connection for the entire SSE lifetime — at pool=25 in
      # production, ~25 concurrent streams exhaust the pool and every
      # other API request blocks on ConnectionTimeoutError. In-loop
      # queries below check out a connection only for the query's
      # duration via with_connection.
      ActiveRecord::Base.connection_pool.release_connection

      loop do
        payload = queue.pop          # blocks until a message arrives
        break if payload.nil?
        break unless refresh_sse_stream_lease(lease, stream_name: "events")
        parsed  = JSON.parse(payload)

        next unless event_visible_to_scope?(parsed, user_org_id: user_org_id, user_ao_id: user_ao_id, site_area_cache: site_area_cache)

        break unless sse_write(response.stream, event: parsed["event"], data: parsed["data"])
      rescue JSON::ParserError => e
        Rails.logger.error("[SSE] malformed queue payload — skipping: #{e.message}")
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      end

    ensure
      heartbeat&.kill
      broadcaster&.unsubscribe(queue) if queue
      release_sse_stream_lease(lease, stream_name: "events")
      response.stream.close if response.stream.respond_to?(:close)
    end

    private

    # Mark this controller as an SSE endpoint so the auth concern:
    # 1. Accepts the JWT from ?token= query param (EventSource limitation)
    # 2. Accepts short-lived SSE-only tokens issued by SseTokensController
    def sse_endpoint?
      true
    end

    def sse_write(stream, event:, data:)
      stream.write("event: #{event}\n")
      stream.write("data: #{data.to_json}\n\n")
      true
    rescue IOError, ActionController::Live::ClientDisconnected
      false
    end

    def event_visible_to_scope?(parsed, user_org_id:, user_ao_id:, site_area_cache:)
      # Org-scoped filtering: kept as defence-in-depth on the consumer
      # side. The broadcaster's producer-side filter (Tranche 2A,
      # 2026-04-25) already drops cross-tenant events before they
      # reach this queue, but a scope change between subscribe and
      # consume — or a relay payload that bypassed the local filter
      # — could still surface a mismatched event. Repeating the cheap
      # comparison here costs nothing and preserves the guarantee.
      # Events without an organization_id pass through (global events).
      # Users without an organization_id see everything (unrestricted).
      event_org_id = parsed["organization_id"]
      return false if user_org_id.present? && event_org_id.present? && event_org_id != user_org_id
      return true unless user_ao_id.present?

      event_ao_id = event_area_of_operation_id(parsed, site_area_cache: site_area_cache)
      return false if event_ao_id == :unknown
      return true if event_ao_id.blank?

      event_ao_id == user_ao_id
    end

    def event_area_of_operation_id(parsed, site_area_cache:)
      data = parsed["data"].is_a?(Hash) ? parsed["data"] : {}
      explicit_ao_id = data["area_of_operation_id"] || data["ao_id"]
      return explicit_ao_id if explicit_ao_id.present?

      site_id = data["site_id"]
      return nil if site_id.blank?

      site_area_cache.fetch(site_id) do
        # with_connection scopes the checkout to this query only — the
        # SSE thread does not hold a DB connection between events.
        site_area_cache[site_id] = ActiveRecord::Base.connection_pool.with_connection do
          Site.where(id: site_id).pick(:area_of_operation_id)
        end || :unknown
      end
    end
  end
end
