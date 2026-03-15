module Api
  class SignalsController < BaseController
    # GET /api/signals
    # Query params: source, signal_type, from, to, site_id (proximity filter), page, per_page
    def index
      signals = ExternalSignal.all.order(occurred_at: :desc)

      signals = signals.by_source(params[:source])      if params[:source].present?
      signals = signals.by_type(params[:signal_type])   if params[:signal_type].present?
      signals = signals.where("occurred_at >= ?", safe_parse_datetime(params[:from])) if params[:from].present?
      signals = signals.where("occurred_at <= ?", safe_parse_datetime(params[:to]))   if params[:to].present?

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

    private

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
