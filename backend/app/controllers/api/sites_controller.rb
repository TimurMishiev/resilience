module Api
  class SitesController < BaseController
    before_action :require_commander!, only: %i[toggle_status unflag update_geofence]

    TIMELINE_VALID_KINDS = %w[
      signal_detected rule_fired task_created task_transitioned site_event
    ].freeze

    def index
      sites = Site.all.order(:name)
      sites = sites.where(status: params[:status]) if params[:status].present?
      records, meta = paginate(sites)
      render json: { data: records.map { |s| serialize_site(s) }, meta: meta }
    end

    def show
      site = Site.find(params[:id])
      render json: serialize_site(site)
    end

    def risk_history
      site = Site.find(params[:id])
      days = (params[:days] || 7).to_i.clamp(1, 30)

      snapshots = SiteRiskSnapshot
        .for_site(site.id)
        .within_days(days)
        .chronological
        .map { |s| serialize_snapshot(s) }

      render json: {
        data: snapshots,
        meta: { total: snapshots.size, site_id: site.id, days: days }
      }
    end

    def timeline
      site = Site.find(params[:id])
      days = (params[:days] || 7).to_i.clamp(1, 90)

      events = Sites::TimelineService.call(site: site, days: days)

      # Optional kind filter — e.g. ?kinds[]=rule_fired&kinds[]=signal_detected
      if params[:kinds].present?
        allowed = Array(params[:kinds]) & TIMELINE_VALID_KINDS
        events  = events.select { |e| allowed.include?(e[:event_kind]) }
      end

      render json: {
        data:    events,
        meta:    { total: events.size, site_id: site.id, days: days }
      }
    end

    def toggle_status
      site   = Site.find(params[:id])
      before = site.as_json(only: %i[status])
      new_status = site.status == "active" ? "inactive" : "active"

      ActiveRecord::Base.transaction do
        site.update!(status: new_status)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Site",
          entity_id:       site.id,
          event_type:      "site_status_changed",
          action:          "toggle_status",
          before_snapshot: before,
          after_snapshot:  site.as_json(only: %i[status]),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize_site(site)
    end

    def update_geofence
      site   = Site.find(params[:id])
      radius = params[:geofence_radius_km].to_f

      if radius <= 0
        render json: { errors: ["geofence_radius_km must be greater than 0"] }, status: :unprocessable_content
        return
      end

      site.update!(geofence_radius_km: radius)
      render json: serialize_site(site)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def unflag
      site = Site.find(params[:id])

      unless site.flagged_at
        render json: { errors: ["Site is not flagged"] }, status: :unprocessable_content
        return
      end

      before = site.as_json(only: %i[flagged_at flag_reason])

      ActiveRecord::Base.transaction do
        site.update!(flagged_at: nil, flag_reason: nil)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Site",
          entity_id:       site.id,
          event_type:      "site_unflagged",
          action:          "unflag",
          before_snapshot: before,
          after_snapshot:  site.as_json(only: %i[flagged_at flag_reason]),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize_site(site)
    end

    private

    def serialize_snapshot(s)
      {
        id:             s.id,
        recorded_at:    s.recorded_at.iso8601,
        score:          s.score,
        risk_level:     s.risk_level,
        alert_pressure: s.alert_pressure.to_f.round(2),
        task_health:    s.task_health.to_f.round(2),
        signal_density: s.signal_density.to_f.round(2)
      }
    end

    def serialize_site(site)
      site.as_json(only: %i[id name latitude longitude status area_of_operation_id flagged_at flag_reason geofence_radius_km created_at])
    end
  end
end
