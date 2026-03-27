module Api
  class PlanningController < BaseController
    before_action :require_commander!

    TASK_LIMIT = 500
    INCIDENT_LIMIT = 200
    SALUTE_LIMIT = 50

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
      chokepoints = Chokepoint.includes(:area_of_operation).order(:name).to_a
      commander_intents = CommanderIntent.order(updated_at: :desc).to_a
      pace_plans = PacePlan.order(updated_at: :desc).to_a

      # Fetch up to SALUTE_LIMIT per AO so one active AO cannot starve another.
      # areas is already loaded (small set); N small queries beats one global slice.
      salute_reports_truncated = false
      salute_report_meta_by_ao = {}
      salute_reports = areas.flat_map do |ao|
        rows = SaluteReport
          .includes(:area_of_operation, :site, :created_by)
          .where(area_of_operation_id: ao.id)
          .recent_first
          .limit(SALUTE_LIMIT + 1)
          .to_a
        area_truncated = rows.size > SALUTE_LIMIT
        visible_rows = rows.first(SALUTE_LIMIT)
        salute_reports_truncated = true if area_truncated
        salute_report_meta_by_ao[ao.id] = {
          truncated: area_truncated,
          count: visible_rows.size,
        }
        visible_rows
      end

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
        chokepoints:         chokepoints.map { |point| serialize_chokepoint(point) },
        commander_intents:   commander_intents.map { |intent| serialize_commander_intent(intent) },
        pace_plans:          pace_plans.map { |plan| serialize_pace_plan(plan) },
        salute_reports:      salute_reports.map { |report| serialize_salute_report(report) },
        open_incidents:      open_incidents.map { |i| serialize_planning_incident(i) },
        meta: {
          truncated:           truncated,
          task_count:          task_records.size,
          incidents_truncated: incidents_truncated,
          incident_count:      open_incidents.size,
          salute_reports_truncated: salute_reports_truncated,
          salute_report_count: salute_reports.size,
          salute_report_meta_by_ao: salute_report_meta_by_ao,
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

    def serialize_commander_intent(intent)
      {
        id: intent.id,
        area_of_operation_id: intent.area_of_operation_id,
        title: intent.title,
        objective: intent.objective,
        end_state: intent.end_state,
        constraints: intent.constraints,
        created_by_id: intent.created_by_id,
        updated_by_id: intent.updated_by_id,
        created_at: intent.created_at,
        updated_at: intent.updated_at,
      }
    end

    def serialize_chokepoint(chokepoint)
      {
        id: chokepoint.id,
        area_of_operation_id: chokepoint.area_of_operation_id,
        area_of_operation_name: chokepoint.area_of_operation.name,
        name: chokepoint.name,
        category: chokepoint.category,
        status: chokepoint.status,
        latitude: chokepoint.latitude.to_f,
        longitude: chokepoint.longitude.to_f,
        watch_radius_km: chokepoint.watch_radius_km.to_f,
        notes: chokepoint.notes,
        created_by_id: chokepoint.created_by_id,
        updated_by_id: chokepoint.updated_by_id,
        created_at: chokepoint.created_at,
        updated_at: chokepoint.updated_at,
      }
    end

    def serialize_pace_plan(plan)
      {
        id: plan.id,
        area_of_operation_id: plan.area_of_operation_id,
        primary_plan: plan.primary_plan,
        alternate_plan: plan.alternate_plan,
        contingency_plan: plan.contingency_plan,
        emergency_plan: plan.emergency_plan,
        notes: plan.notes,
        created_by_id: plan.created_by_id,
        updated_by_id: plan.updated_by_id,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
      }
    end

    def serialize_salute_report(report)
      {
        id: report.id,
        area_of_operation_id: report.area_of_operation_id,
        area_of_operation_name: report.area_of_operation.name,
        site_id: report.site_id,
        site_name: report.site&.name,
        size: report.size,
        activity: report.activity,
        location: report.location,
        unit: report.unit,
        observed_at: report.observed_at,
        equipment: report.equipment,
        remarks: report.remarks,
        created_by_id: report.created_by_id,
        created_at: report.created_at,
      }
    end
  end
end
