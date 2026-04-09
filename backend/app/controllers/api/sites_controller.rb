module Api
  class SitesController < BaseController
    before_action :require_commander!, only: %i[toggle_status unflag update_geofence]
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    TIMELINE_VALID_KINDS = %w[
      signal_detected rule_fired task_created task_transitioned site_event
    ].freeze

    def index
      authorize Site
      sites = policy_scope(Site).order(:name)
      sites = sites.where(status: params[:status]) if params[:status].present?

      if as_of
        sites = sites.where("created_at <= ?", as_of)
        records, meta = paginate(sites)
        snapshots = latest_audit_snapshots(entity_type: "Site", entity_ids: records.map(&:id), as_of: as_of)
        render json: { data: records.map { |site| serialize_site(site, snapshot: snapshots[site.id]) }, meta: meta }
        return
      end

      records, meta = paginate(sites)
      render json: { data: records.map { |s| serialize_site(s) }, meta: meta }
    end

    def show
      site = scoped_record(Site, params[:id])
      authorize site

      if as_of
        return render json: { errors: ["Site not found"] }, status: :not_found if site.created_at > as_of

        snapshot = latest_audit_snapshots(entity_type: "Site", entity_ids: [site.id], as_of: as_of)[site.id]
        render json: serialize_site(site, snapshot: snapshot)
      else
        render json: serialize_site(site)
      end
    end

    def risk_history
      site = scoped_record(Site, params[:id])
      authorize site, :risk_history?
      days = (params[:days] || 7).to_i.clamp(1, 30)
      cutoff = as_of || Time.current

      snapshots = SiteRiskSnapshot
        .for_site(site.id)
        .where(recorded_at: (cutoff - days.days)..cutoff)
        .chronological
        .map { |s| serialize_snapshot(s) }

      render json: {
        data: snapshots,
        meta: { total: snapshots.size, site_id: site.id, days: days, as_of: as_of&.iso8601 }
      }
    end

    def timeline
      site = scoped_record(Site, params[:id])
      authorize site, :timeline?
      days = (params[:days] || 7).to_i.clamp(1, 90)

      events = Sites::TimelineService.call(site: site, days: days, as_of: as_of)
      # Optional kind filter — e.g. ?kinds[]=rule_fired&kinds[]=signal_detected
      if params[:kinds].present?
        allowed = Array(params[:kinds]) & TIMELINE_VALID_KINDS
        events  = events.select { |e| allowed.include?(e[:event_kind]) }
      end

      render json: {
        data:    events,
        meta:    { total: events.size, site_id: site.id, days: days, as_of: as_of&.iso8601 }
      }
    end

    def toggle_status
      site   = scoped_record(Site, params[:id])
      authorize site, :toggle_status?
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

      Sse::Broadcaster.instance.publish(event: "site_risk_updated", organization_id: site.organization_id, data: { site_id: site.id })
      render json: serialize_site(site)
    end

    def update_geofence
      site   = scoped_record(Site, params[:id])
      authorize site, :update_geofence?
      radius = params[:geofence_radius_km].to_f

      if radius <= 0
        render json: { errors: ["geofence_radius_km must be greater than 0"] }, status: :unprocessable_content
        return
      end

      before_radius = site.geofence_radius_km

      ApplicationRecord.transaction do
        site.update!(geofence_radius_km: radius)
        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Site",
          entity_id:       site.id,
          event_type:      "site_geofence_updated",
          before_snapshot: { geofence_radius_km: before_radius },
          after_snapshot:  { geofence_radius_km: radius },
          correlation_id:  SecureRandom.uuid
        )
      end

      Sse::Broadcaster.instance.publish(event: "site_risk_updated", organization_id: site.organization_id, data: { site_id: site.id })
      render json: serialize_site(site)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def unflag
      site = scoped_record(Site, params[:id])
      authorize site, :unflag?

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

      Sse::Broadcaster.instance.publish(event: "site_risk_updated", organization_id: site.organization_id, data: { site_id: site.id })
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

    def serialize_site(site, snapshot: nil)
      {
        id: site.id,
        name: snapshot_or_current(snapshot, "name", site.name),
        latitude: snapshot_or_current(snapshot, "latitude", site.latitude),
        longitude: snapshot_or_current(snapshot, "longitude", site.longitude),
        status: snapshot_or_current(snapshot, "status", site.status),
        area_of_operation_id: snapshot_or_current(snapshot, "area_of_operation_id", site.area_of_operation_id),
        flagged_at: snapshot_or_current(snapshot, "flagged_at", site.flagged_at),
        flag_reason: snapshot_or_current(snapshot, "flag_reason", site.flag_reason),
        geofence_radius_km: snapshot_or_current(snapshot, "geofence_radius_km", site.geofence_radius_km),
        created_at: site.created_at,
        updated_at: site.updated_at,
      }
    end
  end
end
