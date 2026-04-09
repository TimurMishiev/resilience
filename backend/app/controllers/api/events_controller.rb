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
      queue       = broadcaster.subscribe

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
      # Org-scoped filtering: skip events from a different organization.
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
        site_area_cache[site_id] = Site.where(id: site_id).pick(:area_of_operation_id) || :unknown
      end
    end
  end
end
