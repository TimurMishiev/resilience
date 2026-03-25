module Api
  class TelemetryController < BaseController
    include ActionController::Live

    # GET /api/telemetry
    # Returns the latest telemetry reading per asset, optionally as of a replay
    # timestamp. This gives replay mode a deterministic snapshot instead of
    # suppressing telemetry entirely.
    def index
      upper_bound = as_of || Time.current

      readings = TelemetryReading
        .select("DISTINCT ON (asset_id) telemetry_readings.*")
        .where("occurred_at <= ?", upper_bound)
        .includes(:asset)
        .order("asset_id, occurred_at DESC")

      render json: {
        data: readings.sort_by { |reading| reading.asset.name }.map { |reading| serialize_reading(reading) },
        meta: { as_of: upper_bound.iso8601, total: readings.size },
      }
    end

    # GET /api/telemetry/stream
    # Server-Sent Events stream of asset telemetry readings.
    # Auth via ?token= query param (EventSource can't send custom headers).
    def stream
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
        break if payload.nil?
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

    # Only the stream action is an SSE endpoint. Snapshot reads should keep
    # normal API/browser auth semantics.
    def sse_endpoint?
      action_name == "stream"
    end

    def sse_write(stream, event:, data:)
      stream.write("event: #{event}\ndata: #{data.to_json}\n\n")
    rescue IOError, ActionController::Live::ClientDisconnected
      # client gone — let the main loop handle cleanup
    end

    def serialize_reading(reading)
      {
        asset_id: reading.asset_id,
        name:     reading.asset.name,
        lat:      reading.lat,
        lng:      reading.lng,
        heading:  reading.heading,
        speed:    reading.speed,
        battery:  reading.battery,
        ts:       reading.occurred_at.to_i,
      }
    end
  end
end
