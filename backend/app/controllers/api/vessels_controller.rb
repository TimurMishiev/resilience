module Api
  class VesselsController < BaseController
    # GET /api/vessels?mmsi=N&loitering=true&dark_hours=N&per_page=N&page=N
    def index
      vessels = Vessel.all.order(last_seen_at: :desc)
      vessels = vessels.where(mmsi: params[:mmsi])                 if params[:mmsi].present?
      vessels = vessels.loitering                                   if params[:loitering].present?
      vessels = vessels.dark_since(params[:dark_hours].to_i.hours) if params[:dark_hours].present?
      records, meta = paginate(vessels)
      render json: { data: records.map { |v| serialize_vessel(v) }, meta: meta }
    end

    # GET /api/vessels/:id
    def show
      vessel = Vessel.find(params[:id])
      render json: serialize_vessel(vessel)
    end

    # GET /api/vessels/:id/tracks?from=ISO&to=ISO&limit=500
    def tracks
      vessel = Vessel.find(params[:id])
      scope  = vessel.vessel_tracks.order(occurred_at: :asc)
      scope  = scope.between(safe_parse_datetime(params[:from]), safe_parse_datetime(params[:to])) if params[:from].present? && params[:to].present?
      scope  = scope.limit([(params[:limit] || 500).to_i, 1000].min)
      render json: { data: scope.map { |t| serialize_track(t) } }
    end

    private

    def serialize_vessel(v)
      v.as_json(only: %i[
        id mmsi name vessel_type flag destination
        lat lng speed heading
        first_seen_at last_seen_at loitering_since
      ]).merge(
        dark:      v.dark?,
        loitering: v.loitering_since.present?,
        last_signal_id: v.last_signal_id
      )
    end

    def serialize_track(t)
      t.as_json(only: %i[id lat lng speed heading occurred_at])
    end
  end
end
