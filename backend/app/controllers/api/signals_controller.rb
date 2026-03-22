module Api
  class SignalsController < BaseController
    before_action :require_commander!, only: %i[create]

    # GET /api/signals
    # Query params: source, signal_type, from, to, site_id (proximity filter), page, per_page
    def index
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
      render json: { data: records.map { |s| serialize_signal(s) }, meta: meta }
    end

    # GET /api/signals/:id
    def show
      signal = ExternalSignal.find(params[:id])
      render json: serialize_signal(signal)
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

      render json: serialize_signal(result.signal), status: :created
    end

    private

    def signal_params
      params.require(:signal).permit(:signal_type, :lat, :lng, :magnitude, :note)
    end

    def serialize_signal(signal)
      signal.as_json(only: %i[
        id source signal_type external_id
        lat lng altitude speed heading magnitude
        occurred_at ingested_at
      ]).merge(
        raw_payload: signal.raw_payload
      )
    end
  end
end
