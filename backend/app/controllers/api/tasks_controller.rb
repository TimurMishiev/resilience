module Api
  class TasksController < BaseController
    after_action :verify_authorized

    def index
      authorize Task
      if as_of
        # Replay returns a bounded snapshot set — pagination is not applied.
        render json: { data: replayed_tasks, meta: nil }
      else
        records, meta = paginate(scoped_tasks.order(created_at: :desc))
        render json: { data: records.map { |t| serialize_task(t) }, meta: meta }
      end
    end

    def show
      authorize Task, :show?
      if as_of
        snapshot = replay_single_task(params[:id])
        return render json: { errors: ["Task not found"] }, status: :not_found unless snapshot
        render json: snapshot
      else
        task = Task.includes(:asset, site: :area_of_operation).find(params[:id])
        render json: serialize_task(task)
      end
    end

    def create
      authorize Task, :create?
      result = Tasks::CreationService.call(params: task_create_params, actor: actor)
      if result.success
        task = result.payload[:task]
        broadcast("task_created", task)
        render json: serialize_task(task), status: :created
      else
        render_service_failure(result)
      end
    end

    def update
      task = Task.find(params[:id])
      authorize task
      result = Tasks::UpdateService.call(task: task, params: task_update_params, actor: actor, actor_role: current_user.role)
      if result.success
        task = result.payload[:task]
        broadcast("task_updated", task)
        render json: serialize_task(task)
      else
        render_service_failure(result)
      end
    end

    def transition
      task = Task.find(params[:id])
      authorize task, :transition?
      result = Tasks::TransitionService.call(
        task:           task,
        to_status:      transition_params[:to_status],
        actor:          actor,
        actor_role:     current_user.role,
        blocked_reason: transition_params[:blocked_reason]
      )
      if result.success
        task = result.payload[:task]
        broadcast("task_transitioned", task)
        render json: serialize_task(task)
      else
        render_service_failure(result)
      end
    end

    def allowed_transitions
      task = Task.find(params[:id])
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

    def scoped_tasks
      tasks = Task.includes(:asset, site: :area_of_operation)
      tasks = tasks.where(site_id: params[:site_id]) if params[:site_id].present?
      tasks = tasks.where(workflow_status: params[:workflow_status]) if params[:workflow_status].present?
      tasks = tasks.where(priority: params[:priority]) if params[:priority].present?
      tasks
    end

    REPLAY_LIMIT = 500

    def replayed_tasks
      task_ids = scoped_tasks.limit(REPLAY_LIMIT).pluck(:id)
      result = Replay::ProjectionService.call(
        entity_type: "Task",
        entity_ids: task_ids,
        as_of: as_of
      )
      result.payload[:snapshots]
    end

    def replay_single_task(id)
      result = Replay::ProjectionService.call(
        entity_type: "Task",
        entity_ids: [id],
        as_of: as_of
      )
      result.payload[:snapshots].first
    end

    def serialize_task(task)
      task.as_json(only: %i[id site_id asset_id title description priority
                             workflow_status blocked_reason resolved_at created_at])
          .merge(
            "site_name"  => task.site&.name,
            "ao_id"      => task.site&.area_of_operation_id,
            "ao_posture" => task.site&.area_of_operation&.posture
          )
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
