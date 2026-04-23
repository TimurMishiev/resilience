module Api
  class TelemetryController < BaseController
    include ActionController::Live

    # Cap per-asset trail points so the response stays bounded. 30 min at 3s
    # tick = 600 raw; 200 keeps JSON tight while preserving smooth polylines.
    TRAIL_POINT_LIMIT = 200
    TRAIL_WINDOW_MINUTES_DEFAULT = 30
    TRAIL_WINDOW_MINUTES_MAX = 120

    # GET /api/telemetry
    # Returns the latest telemetry reading per asset, optionally as of a replay
    # timestamp. This gives replay mode a deterministic snapshot instead of
    # suppressing telemetry entirely.
    def index
      authorize TelemetryReading
      upper_bound = as_of || Time.current

      visible_asset_ids = policy_scope(Asset).select(:id)

      readings = TelemetryReading
        .select("DISTINCT ON (asset_id) telemetry_readings.*")
        .where(asset_id: visible_asset_ids)
        .where("occurred_at <= ?", upper_bound)
        .includes(:asset)
        .order("asset_id, occurred_at DESC")

      render json: {
        data: readings.sort_by { |reading| reading.asset.name }.map { |reading| serialize_reading(reading) },
        meta: { as_of: upper_bound.iso8601, total: readings.size },
      }
    end

    # GET /api/telemetry/trails?as_of=ISO8601&window_minutes=30
    # Returns windowed trail points for every asset within a replay time range.
    # Replay-only by intent — live mode uses the SSE stream for current positions.
    def trails
      authorize TelemetryReading, :trails?
      upper_bound    = as_of || Time.current
      window_minutes = [
        [params.fetch(:window_minutes, TRAIL_WINDOW_MINUTES_DEFAULT).to_i, 1].max,
        TRAIL_WINDOW_MINUTES_MAX,
      ].min
      lower_bound = upper_bound - window_minutes.minutes

      visible_asset_ids = policy_scope(Asset).select(:id)

      # Use ROW_NUMBER() to cap at TRAIL_POINT_LIMIT per asset at the SQL layer
      # so we never materialize unbounded rows in Ruby.
      cte_sql = TelemetryReading
        .select("telemetry_readings.*, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY occurred_at DESC) AS rn")
        .where(asset_id: visible_asset_ids)
        .where(occurred_at: lower_bound..upper_bound)
        .to_sql

      readings = TelemetryReading
        .from("(#{cte_sql}) AS telemetry_readings")
        .where("rn <= ?", TRAIL_POINT_LIMIT)
        .includes(:asset)
        .order(:asset_id, occurred_at: :desc)

      by_asset = readings.group_by(&:asset_id)

      trails = by_asset.map do |_asset_id, rows|
        asset = rows.first.asset
        points = rows.reverse # oldest → newest
        {
          asset_id: asset.id,
          name:     asset.name,
          status:   asset.status,
          points:   points.map { |r| { lat: r.lat, lng: r.lng, heading: r.heading, speed: r.speed, ts: r.occurred_at.to_i } },
        }
      end.sort_by { |t| t[:name] }

      render json: {
        data: trails,
        meta: {
          as_of:          upper_bound.iso8601,
          from:           lower_bound.iso8601,
          window_minutes: window_minutes,
          asset_count:    trails.size,
        },
      }
    end

    # GET /api/telemetry/stream
    # Server-Sent Events stream of asset telemetry readings.
    # Auth via ?token= query param (EventSource can't send custom headers).
    def stream
      authorize TelemetryReading, :stream?
      lease = admit_sse_stream!(stream_name: "telemetry")
      return unless lease

      response.headers["Content-Type"]      = "text/event-stream"
      response.headers["Cache-Control"]     = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      broadcaster = Telemetry::Broadcaster.instance
      queue       = broadcaster.subscribe

      # Send an initial connected event so the client knows the stream is live
      return unless sse_write(response.stream, event: "connected", data: { message: "telemetry stream open" })

      # Snapshot the viewer's visible asset-id set once at stream open. Every
      # subsequent payload is filtered against this set so that cross-tenant
      # telemetry never reaches the client. AssetPolicy::Scope is the same
      # authoritative gate used by /api/telemetry (the snapshot endpoint),
      # which keeps live + replay consistent. New assets added to the viewer's
      # scope mid-stream are picked up on reconnect.
      allowed_asset_ids = policy_scope(Asset).pluck(:id).to_set

      # Heartbeat thread — keeps the connection alive through proxies / load balancers
      heartbeat = start_sse_heartbeat(stream_name: "telemetry") do
        refresh_sse_stream_lease(lease, stream_name: "telemetry") &&
          sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
      end

      # Main loop — pop telemetry payloads and forward to the client
      loop do
        payload = queue.pop
        break if payload.nil?
        break unless refresh_sse_stream_lease(lease, stream_name: "telemetry")
        next unless telemetry_payload_visible?(payload, allowed_asset_ids)
        response.stream.write("event: telemetry\ndata: #{payload}\n\n")
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      end
    ensure
      heartbeat&.kill
      broadcaster&.unsubscribe(queue) if queue
      release_sse_stream_lease(lease, stream_name: "telemetry")
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
      true
    rescue IOError, ActionController::Live::ClientDisconnected
      false
    end

    # Drop payloads whose asset_id is outside the viewer's allowed set. A
    # malformed payload is dropped and logged — never breaks the stream loop.
    def telemetry_payload_visible?(payload, allowed_asset_ids)
      parsed = JSON.parse(payload)
      allowed_asset_ids.include?(parsed["asset_id"])
    rescue JSON::ParserError => e
      Rails.logger.error("[Telemetry] malformed queue payload — skipping: #{e.message}")
      false
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
