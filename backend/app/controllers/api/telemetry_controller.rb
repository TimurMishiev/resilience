module Api
  class TelemetryController < ApplicationController
    include ActionController::Live
    include JwtAuthenticatable

    # GET /api/telemetry/stream
    # Server-Sent Events stream of asset telemetry readings.
    # Auth via ?token= query param (EventSource can't send custom headers).
    def stream
      authenticate_request!

      response.headers["Content-Type"]      = "text/event-stream"
      response.headers["Cache-Control"]     = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      broadcaster = Telemetry::Broadcaster.instance
      queue       = broadcaster.subscribe

      # Send an initial connected event so the client knows the stream is live
      sse_write(response.stream, event: "connected", data: { message: "telemetry stream open" })

      # Heartbeat thread — keeps the connection alive through proxies / load balancers
      heartbeat = Thread.new do
        loop do
          sleep 25
          sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
        rescue IOError, ActionController::Live::ClientDisconnected
          break
        end
      end

      # Main loop — pop telemetry payloads and forward to the client
      loop do
        payload = queue.pop
        response.stream.write("event: telemetry\ndata: #{payload}\n\n")
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      end
    ensure
      heartbeat&.kill
      broadcaster.unsubscribe(queue) if queue
      response.stream.close rescue nil
    end

    private

    def sse_write(stream, event:, data:)
      stream.write("event: #{event}\ndata: #{data.to_json}\n\n")
    rescue IOError, ActionController::Live::ClientDisconnected
      # client gone — let the main loop handle cleanup
    end
  end
end
