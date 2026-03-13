module Tasks
  # Updates mutable metadata fields on a Task and writes an audit event in the same transaction.
  # Workflow transitions are handled exclusively by TransitionService — not here.
  class UpdateService < ApplicationService
    PERMITTED_FIELDS = %w[title description priority].freeze

    def initialize(task:, params:, actor:)
      @task   = task
      @params = params.to_h.slice(*PERMITTED_FIELDS)
      @actor  = actor
    end

    def call
      return ServiceResult.failure(errors: ["No updatable fields provided"]) if @params.empty?

      before = task_snapshot(@task)
      correlation_id = SecureRandom.uuid

      ActiveRecord::Base.transaction do
        @task.assign_attributes(@params)

        unless @task.valid?
          raise ActiveRecord::Rollback
        end

        @task.save!

        Audit::EventWriter.write(
          actor: @actor,
          entity_type: "Task",
          entity_id: @task.id,
          event_type: "task.updated",
          action: "update",
          before_snapshot: before,
          after_snapshot: task_snapshot(@task),
          correlation_id: correlation_id
        )
      end

      if @task.errors.any?
        ServiceResult.failure(errors: @task.errors.full_messages)
      else
        ServiceResult.success(task: @task)
      end
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end

    private

    def task_snapshot(task)
      task.attributes.except("updated_at")
    end
  end
end
