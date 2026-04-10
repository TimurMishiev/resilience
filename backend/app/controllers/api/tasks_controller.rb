module Api
  class TasksController < BaseController
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    def index
      authorize Task
      if as_of
        tasks = replay_scoped_tasks
        records, meta = paginate_transformed_relation(tasks.order(created_at: :desc)) do |batch|
          serialize_replay_tasks(batch, as_of: as_of).select do |record|
            replay_task_matches_filters?(record)
          end
        end
        render json: { data: records, meta: meta }
      else
        records, meta = paginate(scoped_tasks.order(created_at: :desc))
        render json: { data: records.map { |t| serialize_task(t) }, meta: meta }
      end
    end

    def show
      task = scoped_record(Task, params[:id], includes: [:asset, { site: :area_of_operation }])
      authorize task, :show?
      if as_of
        serialized = serialize_replay_tasks([task], as_of: as_of).first
        return render json: { errors: ["Task not found"] }, status: :not_found unless serialized

        render json: serialized
      else
        render json: serialize_task(task)
      end
    end

    def create
      task = Task.new(task_create_params)
      authorize task, :create?
      result = Tasks::CreationService.call(params: task_create_params, actor: actor)
      if result.success
        task = Task.includes(:asset, site: :area_of_operation).find(result.payload[:task].id)
        broadcast("task_created", task)
        render json: serialize_task(task), status: :created
      else
        render_service_failure(result)
      end
    end

    def update
      task = scoped_record(Task, params[:id])
      authorize task
      result = Tasks::UpdateService.call(task: task, params: task_update_params, actor: actor, actor_role: current_user.role)
      if result.success
        task = Task.includes(:asset, site: :area_of_operation).find(result.payload[:task].id)
        broadcast("task_updated", task)
        render json: serialize_task(task)
      else
        render_service_failure(result)
      end
    end

    def transition
      task = scoped_record(Task, params[:id])
      authorize task, :transition?
      result = Tasks::TransitionService.call(
        task:           task,
        to_status:      transition_params[:to_status],
        actor:          actor,
        actor_role:     current_user.role,
        blocked_reason: transition_params[:blocked_reason]
      )
      if result.success
        task = Task.includes(:asset, site: :area_of_operation).find(result.payload[:task].id)
        broadcast("task_transitioned", task)
        render json: serialize_task(task)
      else
        render_service_failure(result)
      end
    end

    def allowed_transitions
      task = scoped_record(Task, params[:id])
      authorize task, :allowed_transitions?
      allowed = Tasks::TransitionService.allowed_transitions_for(
        task.workflow_status,
        role: current_user.role
      )
      # commander_only: subset of the allowed list that requires Commander authority.
      # Always empty for operators (those transitions are already excluded from allowed).
      # Lets the frontend render a ★ badge without hardcoding the same list client-side.
      commander_only = Tasks::TransitionService::COMMANDER_ONLY_TRANSITIONS
                         .fetch(task.workflow_status, [])
                         .intersection(allowed)
      render json: { allowed: allowed, commander_only: commander_only }
    end

    private

    # Base scope shared by live and replay paths. Workflow/priority filters
    # are added only in the live path — replay applies them post-snapshot.
    def base_scoped_tasks
      tasks = policy_scope(Task).includes(:asset, site: :area_of_operation)
      tasks = tasks.where(site_id: params[:site_id]) if params[:site_id].present?
      tasks
    end

    def scoped_tasks
      tasks = base_scoped_tasks
      tasks = tasks.where(workflow_status: params[:workflow_status]) if params[:workflow_status].present?
      tasks = tasks.where(priority: params[:priority]) if params[:priority].present?
      tasks
    end

    alias_method :replay_scoped_tasks, :base_scoped_tasks

    def serialize_replay_tasks(tasks, as_of:)
      task_snapshots = latest_audit_snapshots(entity_type: "Task", entity_ids: tasks.map(&:id), as_of: as_of)
      replay_sites = build_replay_site_index(tasks.map(&:site_id).uniq, as_of: as_of)

      tasks.filter_map do |task|
        snapshot = task_snapshots[task.id]
        next if snapshot.blank?

        serialize_task(
          task,
          snapshot: snapshot,
          replay_site: replay_sites[task.site_id],
          as_of: as_of,
        )
      end
    end

    def build_replay_site_index(site_ids, as_of:)
      return {} if site_ids.empty?

      sites = policy_scope(Site).includes(:area_of_operation).where(id: site_ids).index_by(&:id)
      site_snapshots = latest_audit_snapshots(entity_type: "Site", entity_ids: sites.keys, as_of: as_of)
      area_ids = sites.filter_map do |site_id, site|
        snapshot_or_current(site_snapshots[site_id], "area_of_operation_id", site.area_of_operation_id)
      end.uniq.compact
      areas = policy_scope(AreaOfOperation).where(id: area_ids).index_by(&:id)
      area_snapshots = latest_audit_snapshots(entity_type: "AreaOfOperation", entity_ids: area_ids, as_of: as_of)

      sites.each_with_object({}) do |(site_id, site), index|
        site_snapshot = site_snapshots[site_id]
        area_id = snapshot_or_current(site_snapshot, "area_of_operation_id", site.area_of_operation_id)
        area = area_id.present? ? areas[area_id] : nil
        area_snapshot = area_id.present? ? area_snapshots[area_id] : nil

        index[site_id] = {
          name: snapshot_or_current(site_snapshot, "name", site.name),
          area_of_operation_id: area_id,
          ao_posture: area.present? || area_snapshot.present? ? snapshot_or_current(area_snapshot, "posture", area&.posture) : nil,
        }
      end
    end

    def replay_task_matches_filters?(record)
      return false if params[:workflow_status].present? && record[:workflow_status].to_s != params[:workflow_status].to_s
      return false if params[:priority].present? && record[:priority].to_s != params[:priority].to_s

      true
    end

    def serialize_task(task, snapshot: nil, replay_site: nil, as_of: nil)
      serialized = {
        id: task.id,
        site_id: snapshot_or_current(snapshot, "site_id", task.site_id),
        asset_id: snapshot_or_current(snapshot, "asset_id", task.asset_id),
        title: snapshot_or_current(snapshot, "title", task.title),
        description: snapshot_or_current(snapshot, "description", task.description),
        priority: snapshot_or_current(snapshot, "priority", task.priority),
        workflow_status: snapshot_or_current(snapshot, "workflow_status", task.workflow_status),
        blocked_reason: snapshot_or_current(snapshot, "blocked_reason", task.blocked_reason),
        resolved_at: snapshot_value(snapshot, "resolved_at", fallback: task.resolved_at),
        created_at: task.created_at,
        updated_at: as_of.present? ? [task.updated_at, as_of].min : task.updated_at,
      }

      if replay_site.present?
        serialized.merge(
          site_name: replay_site[:name],
          ao_id: replay_site[:area_of_operation_id],
          ao_posture: replay_site[:ao_posture],
        )
      else
        serialized.merge(
          site_name: task.site&.name,
          ao_id: task.site&.area_of_operation_id,
          ao_posture: task.site&.area_of_operation&.posture,
        )
      end
    end

    def task_create_params
      # workflow_status is intentionally excluded — new tasks always start as 'new'
      # to enforce the state machine. Clients cannot skip states on creation.
      params.require(:task).permit(:site_id, :asset_id, :title, :description, :priority)
    end

    def task_update_params
      params.require(:task).permit(:title, :description, :priority, :asset_id)
    end

    def transition_params
      params.require(:transition).permit(:to_status, :blocked_reason)
    end

    def broadcast(event, task)
      Sse::Broadcaster.instance.publish(
        event: event,
        organization_id: task.site&.organization_id,
        data:  {
          id:              task.id,
          site_id:         task.site_id,
          site_name:       task.site&.name,
          title:           task.title,
          priority:        task.priority,
          workflow_status: task.workflow_status
        }
      )
    rescue StandardError => e
      Rails.logger.error "[TasksBroadcast] event=#{event} task=#{task.id} error=#{e.class}: #{e.message}"
    end
  end
end
