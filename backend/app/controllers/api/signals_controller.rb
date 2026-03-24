module Api
  class SignalsController < BaseController
    include ActionController::Live

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

      response.headers["Content-Type"]      = "text/event-stream"
      response.headers["Cache-Control"]     = "no-cache"
      response.headers["X-Accel-Buffering"] = "no"

      broadcaster = Signals::Broadcaster.instance
      queue       = broadcaster.subscribe
      since       = safe_parse_datetime(params[:since])

      sse_write(response.stream, event: "connected", data: { message: "signal stream open" })

      if since
        ExternalSignal
          .where("ingested_at >= ?", since)
          .order(:ingested_at, :id)
          .each do |signal|
            response.stream.write("event: signal\ndata: #{Signals::PayloadSerializer.call(signal).to_json}\n\n")
          rescue IOError, ActionController::Live::ClientDisconnected
            break
          end
      end

      heartbeat = Thread.new do
        loop do
          sleep 25
          sse_write(response.stream, event: "heartbeat", data: { ts: Time.current.to_i })
        rescue IOError, ActionController::Live::ClientDisconnected
          break
        end
      end

      loop do
        payload = queue.pop
        response.stream.write("event: signal\ndata: #{payload}\n\n")
      rescue IOError, ActionController::Live::ClientDisconnected
        break
      end
    ensure
      heartbeat&.kill
      broadcaster.unsubscribe(queue) if queue
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
    rescue IOError, ActionController::Live::ClientDisconnected
      # client disconnected — caller loop handles cleanup
    end

    def signal_params
      params.require(:signal).permit(:signal_type, :lat, :lng, :magnitude, :note)
    end
  end
end
