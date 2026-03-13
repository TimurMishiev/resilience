module Tasks
  # Validates and executes a workflow transition for a Task.
  # Transition rules are authoritative here — the frontend must not hardcode them.
  # Writes an AuditEvent in the same transaction as the mutation.
  class TransitionService < ApplicationService
    ALLOWED_TRANSITIONS = {
      "new"         => %w[triaged],
      "triaged"     => %w[in_progress],
      "in_progress" => %w[blocked resolved],
      "blocked"     => %w[in_progress],
      "resolved"    => %w[triaged]
    }.freeze

    def initialize(task:, to_status:, actor:, blocked_reason: nil)
      @task = task
      @to_status = to_status
      @actor = actor
      @blocked_reason = blocked_reason
    end

    def call
      unless transition_allowed?
        return ServiceResult.failure(
          errors: ["Transition from '#{@task.workflow_status}' to '#{@to_status}' is not allowed"]
        )
      end

      if @to_status == "blocked" && @blocked_reason.blank?
        return ServiceResult.failure(errors: ["blocked_reason is required when transitioning to blocked"])
      end

      if @to_status != "blocked" && @blocked_reason.present?
        return ServiceResult.failure(errors: ["blocked_reason must not be provided for non-blocked transitions"])
      end

      before = task_snapshot(@task)
      correlation_id = SecureRandom.uuid

      ActiveRecord::Base.transaction do
        @task.workflow_status = @to_status
        @task.blocked_reason = (@to_status == "blocked") ? @blocked_reason : nil
        @task.resolved_at = Time.current if @to_status == "resolved" && @task.resolved_at.nil?

        @task.save!

        Audit::EventWriter.write(
          actor: @actor,
          entity_type: "Task",
          entity_id: @task.id,
          event_type: "task.transitioned",
          action: "transition",
          before_snapshot: before,
          after_snapshot: task_snapshot(@task),
          metadata: { from_status: before["workflow_status"], to_status: @to_status },
          correlation_id: correlation_id
        )
      end

      ServiceResult.success(task: @task)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end

    # Returns the allowed next statuses for a given current status.
    # Used by the API to inform the frontend of available actions.
    def self.allowed_transitions_for(current_status)
      ALLOWED_TRANSITIONS.fetch(current_status, [])
    end

    private

    def transition_allowed?
      ALLOWED_TRANSITIONS.fetch(@task.workflow_status, []).include?(@to_status)
    end

    def task_snapshot(task)
      task.attributes.except("updated_at")
    end
  end
end
