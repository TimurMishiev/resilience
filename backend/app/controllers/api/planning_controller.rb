module Api
  class PlanningController < BaseController
    before_action :require_commander!
    after_action :verify_authorized

    TASK_LIMIT      = 500
    INCIDENT_LIMIT  = 200
    SALUTE_LIMIT    = 50
    ASSET_LIMIT     = 500
    AO_LIMIT        = 50
    CHOKEPOINT_LIMIT = 200
    INTENT_LIMIT    = 50
    PACE_PLAN_LIMIT = 50

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
      authorize :planning, :index?
      return render json: planning_replay_payload(as_of) if as_of.present?

      # Tasks — eager-load site + AO in two queries (no N+1)
      raw_tasks = policy_scope(Task)
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

      raw_assets       = policy_scope(Asset).order(:name).limit(ASSET_LIMIT + 1).to_a
      assets_truncated = raw_assets.size > ASSET_LIMIT
      assets           = assets_truncated ? raw_assets.first(ASSET_LIMIT) : raw_assets
      Rails.logger.warn "[PlanningController] asset cap hit (#{ASSET_LIMIT})" if assets_truncated

      raw_areas       = policy_scope(AreaOfOperation).order(:name).limit(AO_LIMIT + 1).to_a
      areas_truncated = raw_areas.size > AO_LIMIT
      areas           = areas_truncated ? raw_areas.first(AO_LIMIT) : raw_areas
      Rails.logger.warn "[PlanningController] AO cap hit (#{AO_LIMIT})" if areas_truncated

      raw_chokepoints       = policy_scope(Chokepoint).includes(:area_of_operation).order(:name).limit(CHOKEPOINT_LIMIT + 1).to_a
      chokepoints_truncated = raw_chokepoints.size > CHOKEPOINT_LIMIT
      chokepoints           = chokepoints_truncated ? raw_chokepoints.first(CHOKEPOINT_LIMIT) : raw_chokepoints
      Rails.logger.warn "[PlanningController] chokepoint cap hit (#{CHOKEPOINT_LIMIT})" if chokepoints_truncated

      raw_intents       = policy_scope(CommanderIntent).order(updated_at: :desc).limit(INTENT_LIMIT + 1).to_a
      intents_truncated = raw_intents.size > INTENT_LIMIT
      commander_intents = intents_truncated ? raw_intents.first(INTENT_LIMIT) : raw_intents
      Rails.logger.warn "[PlanningController] intent cap hit (#{INTENT_LIMIT})" if intents_truncated

      raw_pace_plans       = policy_scope(PacePlan).order(updated_at: :desc).limit(PACE_PLAN_LIMIT + 1).to_a
      pace_plans_truncated = raw_pace_plans.size > PACE_PLAN_LIMIT
      pace_plans           = pace_plans_truncated ? raw_pace_plans.first(PACE_PLAN_LIMIT) : raw_pace_plans
      Rails.logger.warn "[PlanningController] pace plan cap hit (#{PACE_PLAN_LIMIT})" if pace_plans_truncated

      # Fetch up to SALUTE_LIMIT per AO so one active AO cannot starve another.
      # areas is already loaded (small set); N small queries beats one global slice.
      salute_reports_truncated = false
      salute_report_meta_by_ao = {}
      salute_reports = areas.flat_map do |ao|
        rows = policy_scope(SaluteReport)
          .includes(:site, :created_by)
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
        visible_rows.map { |report| [report, ao.name] }
      end

      raw_incidents = policy_scope(Incident)
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
        salute_reports:      salute_reports.map { |report, ao_name| serialize_salute_report(report, ao_name: ao_name) },
        open_incidents:      open_incidents.map { |i| serialize_planning_incident(i) },
        meta: {
          truncated:           truncated,
          task_count:          task_records.size,
          assets_truncated:    assets_truncated,
          asset_count:         assets.size,
          areas_truncated:     areas_truncated,
          area_count:          areas.size,
          chokepoints_truncated: chokepoints_truncated,
          chokepoint_count:    chokepoints.size,
          intents_truncated:   intents_truncated,
          intent_count:        commander_intents.size,
          pace_plans_truncated: pace_plans_truncated,
          pace_plan_count:     pace_plans.size,
          incidents_truncated: incidents_truncated,
          incident_count:      open_incidents.size,
          salute_reports_truncated: salute_reports_truncated,
          salute_report_count: salute_reports.size,
          salute_report_meta_by_ao: salute_report_meta_by_ao,
          as_of: nil,
        }
      }
    end

    private

    def planning_replay_payload(cutoff)
      raw_areas, areas_truncated = limited_records(
        policy_scope(AreaOfOperation).where("created_at <= ?", cutoff).order(:name),
        AO_LIMIT,
      )
      area_snapshots = latest_audit_snapshots(entity_type: "AreaOfOperation", entity_ids: raw_areas.map(&:id), as_of: cutoff)
      replay_areas = raw_areas.map { |area| serialize_replay_planning_area(area, area_snapshots[area.id]) }
      replay_area_by_id = replay_areas.index_by { |area| area[:id] }

      visible_site_ids = policy_scope(Site)
        .where("created_at <= ?", cutoff)
        .pluck(:id)
      replay_sites = build_replay_site_index(visible_site_ids, cutoff)

      replay_tasks, tasks_truncated = replay_tasks_as_of(
        cutoff,
        replay_areas: replay_area_by_id,
        replay_sites: replay_sites,
      )

      raw_assets, assets_truncated = limited_records(
        policy_scope(Asset).where("created_at <= ?", cutoff).order(:name),
        ASSET_LIMIT,
      )
      asset_snapshots = latest_audit_snapshots(entity_type: "Asset", entity_ids: raw_assets.map(&:id), as_of: cutoff)
      replay_assets = raw_assets.filter_map do |asset|
        serialize_replay_planning_asset(asset, snapshot: asset_snapshots[asset.id])
      end

      raw_chokepoints, chokepoints_truncated = limited_records(
        policy_scope(Chokepoint)
          .includes(:area_of_operation)
          .where("created_at <= ?", cutoff)
          .order(:name),
        CHOKEPOINT_LIMIT,
      )
      chokepoint_snapshots = latest_audit_snapshots(entity_type: "Chokepoint", entity_ids: raw_chokepoints.map(&:id), as_of: cutoff)
      replay_chokepoints = raw_chokepoints.filter_map do |chokepoint|
        serialize_replay_chokepoint(chokepoint, snapshot: chokepoint_snapshots[chokepoint.id], replay_areas: replay_area_by_id, as_of: cutoff)
      end

      raw_intents, intents_truncated = limited_records(
        policy_scope(CommanderIntent).where("created_at <= ?", cutoff).order(updated_at: :desc),
        INTENT_LIMIT,
      )
      intent_snapshots = latest_audit_snapshots(entity_type: "CommanderIntent", entity_ids: raw_intents.map(&:id), as_of: cutoff)
      replay_intents = raw_intents.filter_map do |intent|
        serialize_replay_commander_intent(intent, snapshot: intent_snapshots[intent.id], replay_areas: replay_area_by_id, as_of: cutoff)
      end

      raw_pace_plans, pace_plans_truncated = limited_records(
        policy_scope(PacePlan).where("created_at <= ?", cutoff).order(updated_at: :desc),
        PACE_PLAN_LIMIT,
      )
      pace_plan_snapshots = latest_audit_snapshots(entity_type: "PacePlan", entity_ids: raw_pace_plans.map(&:id), as_of: cutoff)
      replay_pace_plans = raw_pace_plans.filter_map do |plan|
        serialize_replay_pace_plan(plan, snapshot: pace_plan_snapshots[plan.id], replay_areas: replay_area_by_id, as_of: cutoff)
      end

      salute_reports_truncated = false
      salute_report_meta_by_ao = {}
      replay_salute_reports = replay_areas.flat_map do |area|
        rows = policy_scope(SaluteReport)
          .includes(:site, :created_by)
          .where(area_of_operation_id: area[:id])
          .where("created_at <= ?", cutoff)
          .recent_first
          .limit(SALUTE_LIMIT + 1)
          .to_a
        area_truncated = rows.size > SALUTE_LIMIT
        visible_rows = rows.first(SALUTE_LIMIT)
        salute_reports_truncated = true if area_truncated
        salute_report_meta_by_ao[area[:id]] = {
          truncated: area_truncated,
          count: visible_rows.size,
        }
        visible_rows.map { |report| serialize_replay_salute_report(report, replay_areas: replay_area_by_id, replay_sites: replay_sites) }
      end

      raw_incidents, incidents_truncated = limited_records(
        policy_scope(Incident)
          .includes(:assigned_to)
          .where("created_at <= ?", cutoff)
          .by_severity,
        INCIDENT_LIMIT,
      )
      incident_snapshots = latest_audit_snapshots(entity_type: "Incident", entity_ids: raw_incidents.map(&:id), as_of: cutoff)
      incident_assigned_ids = raw_incidents.filter_map do |incident|
        snapshot_or_current(incident_snapshots[incident.id], "assigned_to_id", incident.assigned_to_id)
      end.uniq.compact
      incident_users_by_id = User.where(id: incident_assigned_ids).index_by(&:id)
      replay_incidents = raw_incidents.filter_map do |incident|
        serialize_replay_planning_incident(
          incident,
          snapshot: incident_snapshots[incident.id],
          users_by_id: incident_users_by_id,
        )
      end

      {
        tasks: replay_tasks,
        assets: replay_assets,
        areas_of_operation: replay_areas,
        chokepoints: replay_chokepoints,
        commander_intents: replay_intents,
        pace_plans: replay_pace_plans,
        salute_reports: replay_salute_reports,
        open_incidents: replay_incidents,
        meta: {
          truncated: tasks_truncated,
          task_count: replay_tasks.size,
          assets_truncated: assets_truncated,
          asset_count: replay_assets.size,
          areas_truncated: areas_truncated,
          area_count: replay_areas.size,
          chokepoints_truncated: chokepoints_truncated,
          chokepoint_count: replay_chokepoints.size,
          intents_truncated: intents_truncated,
          intent_count: replay_intents.size,
          pace_plans_truncated: pace_plans_truncated,
          pace_plan_count: replay_pace_plans.size,
          incidents_truncated: incidents_truncated,
          incident_count: replay_incidents.size,
          salute_reports_truncated: salute_reports_truncated,
          salute_report_count: replay_salute_reports.size,
          salute_report_meta_by_ao: salute_report_meta_by_ao,
          as_of: cutoff.iso8601,
        },
      }
    end

    def limited_records(relation, limit)
      rows = relation.limit(limit + 1).to_a
      [rows.first(limit), rows.size > limit]
    end

    def replay_tasks_as_of(cutoff, replay_areas:, replay_sites:)
      relation = policy_scope(Task)
        .includes(:asset, site: :area_of_operation)
        .where("created_at <= ?", cutoff)
        .order(
          Arel.sql("CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END"),
          created_at: :asc
        )

      replay_tasks = []
      offset = 0

      loop do
        batch = relation.limit(TASK_LIMIT).offset(offset).to_a
        break if batch.empty?

        task_snapshots = latest_audit_snapshots(entity_type: "Task", entity_ids: batch.map(&:id), as_of: cutoff)
        batch.each do |task|
          serialized = serialize_replay_planning_task(
            task,
            snapshot: task_snapshots[task.id],
            replay_areas: replay_areas,
            replay_sites: replay_sites,
          )
          next if serialized.nil?
          return [replay_tasks, true] if replay_tasks.size >= TASK_LIMIT

          replay_tasks << serialized
        end

        break if batch.size < TASK_LIMIT

        offset += batch.size
      end

      [replay_tasks, false]
    end

    def build_replay_site_index(site_ids, cutoff)
      return {} if site_ids.empty?

      sites = policy_scope(Site).where(id: site_ids, created_at: ..cutoff).index_by(&:id)
      snapshots = latest_audit_snapshots(entity_type: "Site", entity_ids: sites.keys, as_of: cutoff)

      sites.each_with_object({}) do |(site_id, site), index|
        snapshot = snapshots[site_id] || {}
        index[site_id] = {
          id: site_id,
          name: snapshot_or_current(snapshot, "name", site.name),
          area_of_operation_id: snapshot_or_current(snapshot, "area_of_operation_id", site.area_of_operation_id),
          status: snapshot_or_current(snapshot, "status", site.status),
          latitude: snapshot_or_current(snapshot, "latitude", site.latitude),
          longitude: snapshot_or_current(snapshot, "longitude", site.longitude),
          geofence_radius_km: snapshot_or_current(snapshot, "geofence_radius_km", site.geofence_radius_km),
        }
      end
    end

    def serialize_replay_planning_task(task, snapshot:, replay_areas:, replay_sites:)
      workflow_status = snapshot_or_current(snapshot, "workflow_status", task.workflow_status)
      return nil if workflow_status == "resolved"

      site = replay_sites[task.site_id]
      area = site ? replay_areas[site[:area_of_operation_id]] : nil

      {
        id: task.id,
        site_id: task.site_id,
        site_name: site ? site[:name] : task.site&.name,
        ao_id: site ? site[:area_of_operation_id] : task.site&.area_of_operation_id,
        ao_posture: area ? area[:posture] : task.site&.area_of_operation&.posture,
        asset_id: snapshot_or_current(snapshot, "asset_id", task.asset_id),
        title: snapshot_or_current(snapshot, "title", task.title),
        description: snapshot_or_current(snapshot, "description", task.description),
        priority: snapshot_or_current(snapshot, "priority", task.priority),
        workflow_status: workflow_status,
        blocked_reason: snapshot_or_current(snapshot, "blocked_reason", task.blocked_reason),
        created_at: task.created_at,
      }
    end

    def serialize_replay_planning_asset(asset, snapshot:)
      {
        id: asset.id,
        name: snapshot_or_current(snapshot, "name", asset.name),
        asset_type: snapshot_or_current(snapshot, "asset_type", asset.asset_type),
        status: snapshot_or_current(snapshot, "status", asset.status),
        home_site_id: snapshot_or_current(snapshot, "home_site_id", asset.home_site_id),
        last_reported_at: snapshot_or_current(snapshot, "last_reported_at", asset.last_reported_at),
      }
    end

    def serialize_replay_planning_area(area, snapshot)
      return serialize_planning_ao(area) if snapshot.blank?

      {
        id: area.id,
        name: snapshot_or_current(snapshot, "name", area.name),
        posture: snapshot_or_current(snapshot, "posture", area.posture),
      }
    end

    def serialize_replay_commander_intent(intent, snapshot:, replay_areas:, as_of: nil)
      area_id = snapshot_or_current(snapshot, "area_of_operation_id", intent.area_of_operation_id)
      return nil unless replay_areas.key?(area_id)

      {
        id: intent.id,
        area_of_operation_id: area_id,
        title: snapshot_or_current(snapshot, "title", intent.title),
        objective: snapshot_or_current(snapshot, "objective", intent.objective),
        end_state: snapshot_or_current(snapshot, "end_state", intent.end_state),
        constraints: snapshot_or_current(snapshot, "constraints", intent.constraints),
        created_by_id: intent.created_by_id,
        updated_by_id: intent.updated_by_id,
        created_at: intent.created_at,
        # QA F3 (2026-04-28): clamp updated_at to as_of during replay.
        updated_at: as_of.present? ? [intent.updated_at, as_of].min : intent.updated_at,
      }
    end

    def serialize_replay_pace_plan(plan, snapshot:, replay_areas:, as_of: nil)
      area_id = snapshot_or_current(snapshot, "area_of_operation_id", plan.area_of_operation_id)
      return nil unless replay_areas.key?(area_id)

      {
        id: plan.id,
        area_of_operation_id: area_id,
        primary_plan: snapshot_or_current(snapshot, "primary_plan", plan.primary_plan),
        alternate_plan: snapshot_or_current(snapshot, "alternate_plan", plan.alternate_plan),
        contingency_plan: snapshot_or_current(snapshot, "contingency_plan", plan.contingency_plan),
        emergency_plan: snapshot_or_current(snapshot, "emergency_plan", plan.emergency_plan),
        notes: snapshot_or_current(snapshot, "notes", plan.notes),
        created_by_id: plan.created_by_id,
        updated_by_id: plan.updated_by_id,
        created_at: plan.created_at,
        # QA F3 (2026-04-28): clamp updated_at to as_of during replay.
        updated_at: as_of.present? ? [plan.updated_at, as_of].min : plan.updated_at,
      }
    end

    def serialize_replay_chokepoint(chokepoint, snapshot:, replay_areas:, as_of: nil)
      return nil if ActiveModel::Type::Boolean.new.cast(snapshot_value(snapshot, "deleted", fallback: nil))

      area_id = snapshot_or_current(snapshot, "area_of_operation_id", chokepoint.area_of_operation_id)
      area = replay_areas[area_id]
      return nil unless area

      {
        id: chokepoint.id,
        area_of_operation_id: area_id,
        area_of_operation_name: area[:name],
        name: snapshot_or_current(snapshot, "name", chokepoint.name),
        category: snapshot_or_current(snapshot, "category", chokepoint.category),
        status: snapshot_or_current(snapshot, "status", chokepoint.status),
        latitude: snapshot_or_current(snapshot, "latitude", chokepoint.latitude).to_f,
        longitude: snapshot_or_current(snapshot, "longitude", chokepoint.longitude).to_f,
        watch_radius_km: snapshot_or_current(snapshot, "watch_radius_km", chokepoint.watch_radius_km).to_f,
        notes: snapshot_or_current(snapshot, "notes", chokepoint.notes),
        created_by_id: chokepoint.created_by_id,
        updated_by_id: chokepoint.updated_by_id,
        created_at: chokepoint.created_at,
        # QA F3 (2026-04-28): clamp updated_at to as_of during replay.
        updated_at: as_of.present? ? [chokepoint.updated_at, as_of].min : chokepoint.updated_at,
      }
    end

    def serialize_replay_salute_report(report, replay_areas:, replay_sites:)
      area = replay_areas[report.area_of_operation_id]
      return nil unless area

      site = report.site_id.present? ? replay_sites[report.site_id] : nil

      {
        id: report.id,
        area_of_operation_id: report.area_of_operation_id,
        area_of_operation_name: area[:name],
        site_id: report.site_id,
        site_name: site ? site[:name] : report.site&.name,
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

    def serialize_replay_planning_incident(incident, snapshot:, users_by_id: {})
      status = snapshot_or_current(snapshot, "status", incident.status)
      return nil if status == "closed"

      assigned_to_id = snapshot_or_current(snapshot, "assigned_to_id", incident.assigned_to_id)
      assigned_user = assigned_to_id.present? ? users_by_id[assigned_to_id] : nil

      {
        id: incident.id,
        title: snapshot_or_current(snapshot, "title", incident.title),
        severity: snapshot_or_current(snapshot, "severity", incident.severity),
        status: status,
        site_id: snapshot_or_current(snapshot, "site_id", incident.site_id),
        ao_id: snapshot_or_current(snapshot, "area_of_operation_id", incident.area_of_operation_id),
        assigned_to: assigned_user ? {
          id: assigned_user.id,
          email: assigned_user.email,
          role: assigned_user.role,
        } : nil,
      }
    end

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

    def serialize_salute_report(report, ao_name:)
      {
        id: report.id,
        area_of_operation_id: report.area_of_operation_id,
        area_of_operation_name: ao_name,
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
