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

    # Transitions that require Commander authority.
    # Operators handle day-to-day triage; Commanders own sign-off actions:
    #   resolved   — marks work complete (requires sign-off)
    #   unblock    — releases a blocked task (requires resource/escalation authority)
    #   reopen     — reopens a resolved task (requires authority to re-open closed work)
    COMMANDER_ONLY_TRANSITIONS = {
      "in_progress" => %w[resolved],
      "blocked"     => %w[in_progress],
      "resolved"    => %w[triaged]
    }.freeze

    def initialize(task:, to_status:, actor:, blocked_reason: nil, actor_role: "commander")
      @task        = task
      @to_status   = to_status
      @actor       = actor
      @blocked_reason = blocked_reason
      @actor_role  = actor_role
    end

    def call
      unless transition_allowed?
        return ServiceResult.failure(
          errors: ["Transition from '#{@task.workflow_status}' to '#{@to_status}' is not allowed"]
        )
      end

      if commander_only_transition? && !commander_role?(@actor_role)
        return ServiceResult.failure(
          errors: ["Commander authority required to transition task to '#{@to_status}'"]
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
        # Set resolved_at on first resolution; clear it if the task is reopened
        # (DB constraint resolved_at_only_when_resolved requires NULL for non-resolved statuses)
        if @to_status == "resolved"
          @task.resolved_at ||= Time.current
        else
          @task.resolved_at = nil
        end

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

    # Returns the allowed next statuses for a given current status and role.
    # Filters out commander-only transitions for operators so the frontend
    # renders only the actions the actor is actually permitted to take.
    def self.allowed_transitions_for(current_status, role: "commander")
      all = ALLOWED_TRANSITIONS.fetch(current_status, [])
      return all if commander_role?(role)

      commander_only = COMMANDER_ONLY_TRANSITIONS.fetch(current_status, [])
      all.reject { |to| commander_only.include?(to) }
    end

    private

    def transition_allowed?
      ALLOWED_TRANSITIONS.fetch(@task.workflow_status, []).include?(@to_status)
    end

    def commander_only_transition?
      COMMANDER_ONLY_TRANSITIONS.fetch(@task.workflow_status, []).include?(@to_status)
    end

    def task_snapshot(task)
      task.attributes.except("updated_at")
    end
  end
end
