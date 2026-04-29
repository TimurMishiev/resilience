module Api
  class TelemetryController < BaseController
    include ActionController::Live

    # Cap per-asset trail points so the response stays bounded. 30 min at 3s
    # tick = 600 raw; 200 keeps JSON tight while preserving smooth polylines.
    TRAIL_POINT_LIMIT = 200
    TRAIL_WINDOW_MINUTES_DEFAULT = 30
    TRAIL_WINDOW_MINUTES_MAX = 120

    # Interval between refreshes of the SSE stream's allowed_asset_ids
    # snapshot. Long-lived streams (often hours) must not continue delivering
    # telemetry for assets the viewer lost visibility into mid-stream (asset
    # reassigned, AO scope revoked). 30s aligns with the signal-feed cadence
    # and keeps revocation-latency operator-visible.
    ALLOWED_ASSETS_REFRESH_SECONDS = 30

    # Unique-identity sentinel pushed into the broadcaster queue by the
    # heartbeat thread on each tick, so the consumer loop wakes for the
    # periodic scope refresh even when no telemetry payload would
    # otherwise arrive. Without this, an admin reassigning a user from
    # org A to org B left the broadcaster's stale producer-side filter
    # dropping every new-org-B reading before it reached this queue —
    # under-delivery indefinitely until reconnect (Codex P2 finding on
    # the prior payload-gated A.3-sibling fix). Identity-comparison via
    # `equal?` distinguishes the sentinel from any broadcaster JSON
    # string payload; see the loop body.
    # Not marked `private_constant` so the regression spec can
    # construct a starvation-scenario queue that pops this exact
    # object identity — the constant carries no behavior, only
    # identity, so exposure is harmless.
    SCOPE_REFRESH_TICK = Object.new.freeze

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

      # Snapshot the viewer's visible asset-id set. Used for both:
      #   1. The broadcaster's tenant-routed delivery (only payloads
      #      for assets in this set are pushed to the subscriber's
      #      queue at all — replaces the old global fan-out).
      #   2. A defence-in-depth per-payload filter inside the loop
      #      below (catches revocations between 30s refresh ticks).
      #
      # Admin/unrestricted users (no org/AO) get :all so the routing
      # layer behaves identically to the previous fan-out for them.
      allowed_asset_ids = ActiveRecord::Base.connection_pool.with_connection do
        policy_scope(Asset).pluck(:id).to_set
      end
      broadcaster_filter = unrestricted_viewer? ? :all : allowed_asset_ids

      broadcaster = Telemetry::Broadcaster.instance
      queue       = broadcaster.subscribe(asset_ids: broadcaster_filter)

      # Send an initial connected event so the client knows the stream is live
      return unless sse_write(response.stream, event: "connected", data: { message: "telemetry stream open" })

      allowed_asset_ids_refreshed_at = Time.current

      # Release the controller-action's checked-out DB connection now that
      # we've read the initial scope. Without this, ActionController::Live
      # holds the connection for the *entire* SSE stream lifetime (often
      # hours) — Rails normally checks connections back in only when the
      # request finishes. With pool=25 in production, ~25 concurrent
      # streams exhaust the pool and every subsequent API request blocks
      # on `ActiveRecord::ConnectionTimeoutError`. Subsequent in-loop
      # queries below check out a connection only for the duration of the
      # query and release it immediately.
      ActiveRecord::Base.connection_pool.release_connection

      # Heartbeat thread — keeps the connection alive through proxies /
      # load balancers AND wakes the consumer loop for the periodic
      # scope refresh (A.3-sibling starvation fix). Sentinel push is
      # non-blocking: a full queue means the broadcaster is already
      # evicting a slow consumer, so we silently skip; the heartbeat
      # write below still proceeds so the browser keeps the EventSource
      # open.
      heartbeat = start_sse_heartbeat(stream_name: "telemetry") do
        next false unless refresh_sse_stream_lease(lease, stream_name: "telemetry")
        push_scope_refresh_tick(queue)
        sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
      end

      # Main loop — pop telemetry payloads and forward to the client
      loop do
        payload = queue.pop
        break if payload.nil?
        break unless refresh_sse_stream_lease(lease, stream_name: "telemetry")

        # Heartbeat-pushed wakeup sentinel — identified by object
        # identity since broadcaster payloads are always JSON Strings.
        # On a sentinel pop we ALWAYS run the refresh (decoupling the
        # refresh trigger from payload arrival is the whole point)
        # and skip downstream telemetry-payload handling.
        is_refresh_tick = payload.equal?(SCOPE_REFRESH_TICK)

        if is_refresh_tick || Time.current - allowed_asset_ids_refreshed_at >= ALLOWED_ASSETS_REFRESH_SECONDS
          # Reload the User from the DB so AssetPolicy::Scope sees fresh
          # organization_id / area_of_operation_id values. Without this,
          # the previous code passed the stream-open `current_user`
          # (in-memory ActiveRecord instance with cached attributes) to
          # the policy, which meant a USER reassignment (admin moves
          # user from org A to org B) was invisible to the scope refresh
          # — only ASSET reassignment (asset moved between sites/orgs)
          # was caught. Pairs with the equivalent A.3 fix in
          # EventsController; closes the symmetric gap on the telemetry
          # SSE stream.
          fresh_user = ActiveRecord::Base.connection_pool.with_connection do
            ActiveRecord::Base.uncached do
              User.find_by(id: current_user.id)
            end
          end
          # User row deleted — close the stream rather than continuing
          # to deliver telemetry for a gone account.
          break if fresh_user.nil?

          # Rebuild the scope from scratch (bypassing Pundit's per-request
          # policy_scope memoisation) and disable AR's query cache so we
          # actually re-read the tenant state instead of the cached
          # snapshot from stream open. with_connection bounds the
          # connection checkout to this query only — the SSE thread is
          # not holding a DB connection while it blocks on queue.pop.
          allowed_asset_ids = ActiveRecord::Base.connection_pool.with_connection do
            ActiveRecord::Base.uncached do
              AssetPolicy::Scope.new(fresh_user, Asset.all).resolve.pluck(:id).to_set
            end
          end
          # Push the refreshed set to the broadcaster too — without this,
          # the broadcaster's filter would stay anchored to whatever was
          # registered at stream open, defeating the point of refreshing.
          # Inline the unrestricted check against fresh_user so a viewer
          # who lost their unrestricted-admin status mid-stream stops
          # seeing every asset.
          fresh_unrestricted = fresh_user.organization_id.blank? && fresh_user.area_of_operation_id.blank?
          broadcaster.update_subscription(queue, asset_ids: fresh_unrestricted ? :all : allowed_asset_ids)
          allowed_asset_ids_refreshed_at = Time.current
        end

        # Sentinels are scope-refresh wakeups, not telemetry payloads
        # to deliver to the client.
        next if is_refresh_tick

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

    # Admin users with no organization or area-of-operation pin see every
    # asset. For routing purposes we register them with the :all sentinel
    # so the broadcaster does not bother computing a filter check on
    # every payload. The per-payload filter in the loop is also a no-op
    # for them — `allowed_asset_ids` contains every asset id, every
    # payload matches.
    def unrestricted_viewer?
      current_user.organization_id.blank? && current_user.area_of_operation_id.blank?
    end

    def sse_write(stream, event:, data:)
      stream.write("event: #{event}\ndata: #{data.to_json}\n\n")
      true
    rescue IOError, ActionController::Live::ClientDisconnected
      false
    end

    # Non-blocking sentinel push from the heartbeat thread. The
    # broadcaster's slow-consumer eviction handles backpressure
    # separately, so a full queue here just means the consumer is
    # already on the way out — silently drop the sentinel.
    def push_scope_refresh_tick(queue)
      queue.push(SCOPE_REFRESH_TICK, true)
    rescue ThreadError, ClosedQueueError
      # ThreadError: queue full (slow consumer being evicted by
      #   broadcaster — no need to wake it for scope refresh).
      # ClosedQueueError: stream is tearing down — sentinel is moot.
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
