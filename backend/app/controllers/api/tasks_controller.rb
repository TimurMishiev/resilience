module Api
  class TasksController < BaseController
    def index
      if as_of
        # Replay returns a bounded snapshot set — pagination is not applied.
        render json: { data: replayed_tasks, meta: nil }
      else
        records, meta = paginate(scoped_tasks.order(created_at: :desc))
        render json: { data: records.map { |t| serialize_task(t) }, meta: meta }
      end
    end

    def show
      if as_of
        snapshot = replay_single_task(params[:id])
        return render json: { errors: ["Task not found"] }, status: :not_found unless snapshot
        render json: snapshot
      else
        task = Task.find(params[:id])
        render json: serialize_task(task)
      end
    end

    def create
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
      result = Tasks::UpdateService.call(task: task, params: task_update_params, actor: actor)
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
      result = Tasks::TransitionService.call(
        task: task,
        to_status: transition_params[:to_status],
        actor: actor,
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
      render json: { allowed: Tasks::TransitionService.allowed_transitions_for(task.workflow_status) }
    end

    private

    def scoped_tasks
      tasks = Task.all
      tasks = tasks.where(site_id: params[:site_id]) if params[:site_id].present?
      tasks = tasks.where(workflow_status: params[:workflow_status]) if params[:workflow_status].present?
      tasks = tasks.where(priority: params[:priority]) if params[:priority].present?
      tasks
    end

    def replayed_tasks
      task_ids = scoped_tasks.pluck(:id)
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
    end

    def task_create_params
      params.require(:task).permit(:site_id, :asset_id, :title, :description, :priority, :workflow_status)
    end

    def task_update_params
      params.require(:task).permit(:title, :description, :priority)
    end

    def transition_params
      params.require(:transition).permit(:to_status, :blocked_reason)
    end

    def broadcast(event, task)
      Sse::Broadcaster.instance.publish(
        event: event,
        data:  { id: task.id, site_id: task.site_id, workflow_status: task.workflow_status }
      )
    rescue StandardError
      # Never let a broadcast failure affect the HTTP response
    end
  end
end
