module Tasks
  # Creates a new Task and writes the corresponding audit event in a single transaction.
  class CreationService < ApplicationService
    def initialize(params:, actor:)
      @params = params
      @actor = actor
    end

    def call
      task = Task.new(@params)

      unless task.valid?
        return ServiceResult.failure(errors: task.errors.full_messages)
      end

      correlation_id = SecureRandom.uuid

      ActiveRecord::Base.transaction do
        task.save!

        Audit::EventWriter.write(
          actor: @actor,
          entity_type: "Task",
          entity_id: task.id,
          event_type: "task.created",
          action: "create",
          before_snapshot: nil,
          after_snapshot: task_snapshot(task),
          correlation_id: correlation_id
        )
      end

      ServiceResult.success(task: task)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end

    private

    def task_snapshot(task)
      task.attributes.except("updated_at")
    end
  end
end
