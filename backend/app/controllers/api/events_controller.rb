module Api
  class EventsController < ApplicationController
    include ActionController::Live
    include JwtAuthenticatable
    include Pundit::Authorization

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
        refresh_sse_stream_lease(lease, stream_name: "events")
        sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
      end

      # Block here, draining the queue until the client disconnects.
      # Broadcaster#publish pushes { event:, data: }.to_json — parse that back
      # and re-emit as proper SSE framing so the browser EventSource can match
      # named-event listeners (e.g. addEventListener('task_created', ...)).
      # Raw JSON written directly would arrive as a 'message' event and silently
      # miss every named listener registered in useEventSource.ts.
      loop do
        payload = queue.pop          # blocks until a message arrives
        break if payload.nil?
        refresh_sse_stream_lease(lease, stream_name: "events")
        parsed  = JSON.parse(payload)
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
  end
end
