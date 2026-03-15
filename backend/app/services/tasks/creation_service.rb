module Tasks
  # Creates a new Task and writes the corresponding audit event in a single transaction.
  # The optional +metadata+ hash is stored on the audit event — used by the correlation
  # engine to record rule_id and signal_id for system-generated tasks.
  class CreationService < ApplicationService
    def initialize(params:, actor:, metadata: nil)
      @params   = params
      @actor    = actor
      @metadata = metadata
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
          metadata: @metadata,
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
