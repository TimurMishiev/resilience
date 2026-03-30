module Api
  class SignalsController < BaseController
    include ActionController::Live

    SIGNAL_STREAM_BASELINE_BATCH_SIZE = 200
    SIGNAL_STREAM_BASELINE_MAX_AGE = 24.hours

    before_action :require_commander!, only: %i[create]

    # GET /api/signals
    # Query params: source, signal_type, from, to, site_id (proximity filter), page, per_page
    def index
      if params[:from].present? && safe_parse_datetime(params[:from]).nil?
        render json: { error: "Invalid 'from' datetime" }, status: :bad_request and return
      end
      if params[:to].present? && safe_parse_datetime(params[:to]).nil?
        render json: { error: "Invalid 'to' datetime" }, status: :bad_request and return
      end

      signals = ExternalSignal.all.order(occurred_at: :desc)
      upper_bound = [safe_parse_datetime(params[:to]), as_of].compact.min

      signals = signals.by_source(params[:source])      if params[:source].present?
      signals = signals.by_type(params[:signal_type])   if params[:signal_type].present?
      signals = signals.where("occurred_at >= ?", safe_parse_datetime(params[:from])) if params[:from].present?
      signals = signals.where("occurred_at <= ?", upper_bound) if upper_bound.present?

      if params[:site_id].present?
        site = Site.find_by(id: params[:site_id])
        if site
          # Pre-filter with bounding box, exact Haversine done in application layer
          signals = signals.near_point(site.latitude, site.longitude, 200)
        end
      end

      records, meta = paginate(signals)
      render json: { data: records.map { |s| Signals::PayloadSerializer.call(s) }, meta: meta }
    end

    # GET /api/signals/:id
    def show
      signal = ExternalSignal.find(params[:id])
      render json: Signals::PayloadSerializer.call(signal)
    end

    # GET /api/signals/stream
    # Live-only Server-Sent Events stream of newly ingested signals.
    # Auth via ?token= query param using the same short-lived SSE token flow as telemetry.
    def stream
      if params[:since].present? && safe_parse_datetime(params[:since]).nil?
        render json: { error: "Invalid 'since' datetime" }, status: :bad_request and return
      end

      lease = admit_sse_stream!(stream_name: "signals")
      return unless lease

      response.headers["Content-Type"]      = "text/event-stream"
      response.headers["Cache-Control"]     = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      broadcaster = Signals::Broadcaster.instance
      requested_since = safe_parse_datetime(params[:since])
      since           = clamped_signal_stream_since(requested_since)
      last_streamed_cursor = nil

      queue = broadcaster.subscribe unless since

      return unless sse_write(response.stream, event: "connected", data: { message: "signal stream open" })

      if since
        baseline_upper_bound = Time.current
        baseline_result = stream_signal_baseline(response.stream, since, baseline_upper_bound, lease: lease)
        return if baseline_result.fetch(:disconnected)

        last_streamed_cursor = baseline_result.fetch(:cursor)

        queue = broadcaster.subscribe
        catchup_upper_bound = Time.current
        catchup_since = last_streamed_cursor ? [since, last_streamed_cursor.fetch(:ingested_at)].max : since
        catchup_result = stream_signal_baseline(
          response.stream,
          catchup_since,
          catchup_upper_bound,
          lease: lease,
          after_cursor: last_streamed_cursor,
        )
        return if catchup_result.fetch(:disconnected)

        last_streamed_cursor = catchup_result.fetch(:cursor)
      end

      heartbeat = start_sse_heartbeat(stream_name: "signals") do
        refresh_sse_stream_lease(lease, stream_name: "signals")
        sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
      end

      loop do
        payload = queue.pop
        break if payload.nil?
        next unless signal_payload_after_cursor?(payload, last_streamed_cursor)
        refresh_sse_stream_lease(lease, stream_name: "signals")
        response.stream.write("event: signal\ndata: #{payload}\n\n")
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      end
    ensure
      heartbeat&.kill
      broadcaster.unsubscribe(queue) if queue
      release_sse_stream_lease(lease, stream_name: "signals")
      response.stream.close rescue nil
    end

    # POST /api/signals
    # Manually inject a signal — triggers correlation engine immediately.
    def create
      p = signal_params

      result = Signals::IngestService.call(
        source:      "manual",
        signal_type: p[:signal_type],
        external_id: "manual-#{SecureRandom.uuid}",
        lat:         p[:lat],
        lng:         p[:lng],
        magnitude:   p[:magnitude].presence,
        occurred_at: Time.current,
        raw_payload: { injected_by: current_user.email, note: p[:note].presence&.truncate(500) }
      )

      unless result.success
        render json: { errors: result.errors }, status: :unprocessable_content
        return
      end

      # Trigger rule evaluation + geofence check immediately
      Correlations::EvaluatorService.call(signal: result.signal)
      Sites::GeofenceBreachService.call(signal: result.signal)

      render json: Signals::PayloadSerializer.call(result.signal), status: :created
    end

    private

    def sse_endpoint?
      action_name == "stream"
    end

    def sse_write(stream, event:, data:)
      stream.write("event: #{event}\ndata: #{data.to_json}\n\n")
      true
    rescue IOError, ActionController::Live::ClientDisconnected
      false
    end

    def clamped_signal_stream_since(since)
      return nil unless since
      [since, SIGNAL_STREAM_BASELINE_MAX_AGE.ago].max
    end

    def stream_signal_baseline(stream, since, upper_bound, lease: nil, after_cursor: nil)
      cursor_ingested_at = nil
      cursor_id = nil

      if after_cursor
        cursor_ingested_at = after_cursor.fetch(:ingested_at)
        cursor_id = after_cursor.fetch(:id)
      end

      loop do
        scope = ExternalSignal
          .where("ingested_at >= ? AND ingested_at <= ?", since, upper_bound)

        if cursor_ingested_at && cursor_id
          scope = scope.where(
            "(ingested_at, id) > (?, ?)",
            cursor_ingested_at,
            cursor_id,
          )
        end

        batch = scope
          .order(:ingested_at, :id)
          .limit(SIGNAL_STREAM_BASELINE_BATCH_SIZE)
          .to_a

        break if batch.empty?

        batch.each do |signal|
          refresh_sse_stream_lease(lease, stream_name: "signals")
          return {
            cursor: signal_stream_cursor(cursor_ingested_at, cursor_id),
            disconnected: true,
          } unless sse_write(stream, event: "signal", data: Signals::PayloadSerializer.call(signal))

          cursor_ingested_at = signal.ingested_at
          cursor_id = signal.id
        end
      end

      {
        cursor: signal_stream_cursor(cursor_ingested_at, cursor_id),
        disconnected: false,
      }
    end

    def signal_payload_after_cursor?(payload, cursor)
      return true unless cursor

      body = JSON.parse(payload)
      ingested_at = Time.iso8601(body.fetch("ingested_at"))
      id = body.fetch("id")

      ingested_at > cursor.fetch(:ingested_at) ||
        (ingested_at == cursor.fetch(:ingested_at) && id > cursor.fetch(:id))
    rescue JSON::ParserError, KeyError, ArgumentError, TypeError
      true
    end

    def signal_stream_cursor(ingested_at, id)
      return nil unless ingested_at && id

      { ingested_at: ingested_at, id: id }
    end

    def signal_params
      params.require(:signal).permit(:signal_type, :lat, :lng, :magnitude, :note)
    end
  end
end
