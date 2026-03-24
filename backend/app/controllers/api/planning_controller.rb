module Api
  class PlanningController < BaseController
    before_action :require_commander!

    TASK_LIMIT = 500
    INCIDENT_LIMIT = 200

    # GET /api/planning
    # Returns a single aggregate payload for the Operational Planning Surface:
    #   tasks            — all non-resolved tasks, enriched with site/AO context
    #   assets           — all assets (status + home_site_id for allocation panel)
    #   areas_of_operation — all AOs (id, name, posture for grouping + badges)
    #   open_incidents   — non-closed incidents (id, severity, assigned_to for overcommitment)
    #   meta             — task_count, truncated flag if > TASK_LIMIT rows
    #
    # Intentionally bypasses BaseController#paginate — the planning surface is a
    # command tool, not a log viewer, and needs the full cross-site picture at once.
    def index
      # Tasks — eager-load site + AO in two queries (no N+1)
      raw_tasks = Task
        .includes(:asset, site: :area_of_operation)
        .where.not(workflow_status: "resolved")
        .order(
          Arel.sql("CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END"),
          created_at: :asc
        )
        .limit(TASK_LIMIT + 1)
        .to_a

      truncated    = raw_tasks.size > TASK_LIMIT
      task_records = truncated ? raw_tasks.first(TASK_LIMIT) : raw_tasks

      assets = Asset.order(:name).to_a

      areas = AreaOfOperation.order(:name).to_a

      raw_incidents = Incident
        .includes(:assigned_to)
        .where.not(status: "closed")
        .by_severity
        .limit(INCIDENT_LIMIT + 1)
        .to_a

      incidents_truncated = raw_incidents.size > INCIDENT_LIMIT
      open_incidents      = incidents_truncated ? raw_incidents.first(INCIDENT_LIMIT) : raw_incidents

      render json: {
        tasks:               task_records.map { |t| serialize_planning_task(t) },
        assets:              assets.map { |a| serialize_planning_asset(a) },
        areas_of_operation:  areas.map  { |ao| serialize_planning_ao(ao) },
        open_incidents:      open_incidents.map { |i| serialize_planning_incident(i) },
        meta: {
          truncated:           truncated,
          task_count:          task_records.size,
          incidents_truncated: incidents_truncated,
          incident_count:      open_incidents.size,
        }
      }
    end

    private

    def serialize_planning_task(task)
      {
        id:              task.id,
        site_id:         task.site_id,
        site_name:       task.site&.name,
        ao_id:           task.site&.area_of_operation_id,
        ao_posture:      task.site&.area_of_operation&.posture,
        asset_id:        task.asset_id,
        title:           task.title,
        description:     task.description,
        priority:        task.priority,
        workflow_status: task.workflow_status,
        blocked_reason:  task.blocked_reason,
        created_at:      task.created_at
      }
    end

    def serialize_planning_asset(asset)
      {
        id:               asset.id,
        name:             asset.name,
        asset_type:       asset.asset_type,
        status:           asset.status,
        home_site_id:     asset.home_site_id,
        last_reported_at: asset.last_reported_at
      }
    end

    def serialize_planning_ao(ao)
      {
        id:      ao.id,
        name:    ao.name,
        posture: ao.posture
      }
    end

    def serialize_planning_incident(incident)
      {
        id:          incident.id,
        title:       incident.title,
        severity:    incident.severity,
        status:      incident.status,
        site_id:     incident.site_id,
        ao_id:       incident.area_of_operation_id,
        assigned_to: incident.assigned_to ? {
          id:    incident.assigned_to.id,
          email: incident.assigned_to.email,
          role:  incident.assigned_to.role
        } : nil
      }
    end
  end
end
