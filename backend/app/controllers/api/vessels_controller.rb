module Api
  class VesselsController < BaseController
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/vessels?mmsi=N&loitering=true&dark_hours=N&per_page=N&page=N
    def index
      authorize Vessel
      vessels = policy_scope(Vessel).order(last_seen_at: :desc)
      vessels = vessels.where(mmsi: params[:mmsi])                 if params[:mmsi].present?
      vessels = vessels.loitering                                   if params[:loitering].present?
      vessels = vessels.dark_since(params[:dark_hours].to_i.hours) if params[:dark_hours].present?
      records, meta = paginate(vessels)
      render json: { data: records.map { |v| serialize_vessel(v) }, meta: meta }
    end

    # GET /api/vessels/:id
    def show
      vessel = scoped_record(Vessel, params[:id])
      authorize vessel
      render json: serialize_vessel(vessel)
    end

    # GET /api/vessels/:id/tracks?from=ISO&to=ISO&limit=500
    def tracks
      vessel = scoped_record(Vessel, params[:id])
      authorize vessel, :tracks?
      from_time = parse_datetime_param!(params[:from], param_name: "from")
      to_time   = parse_datetime_param!(params[:to], param_name: "to")
      scope  = vessel.vessel_tracks
      scope  = scope.where("occurred_at >= ?", from_time) if from_time.present?
      scope  = scope.where("occurred_at <= ?", to_time) if to_time.present?
      tracks = scope.order(occurred_at: :desc)
                    .limit([(params[:limit] || 500).to_i, 1000].min)
                    .to_a
                    .reverse
      render json: { data: tracks.map { |t| serialize_track(t) } }
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
