module Tasks
  # Updates mutable metadata fields on a Task and writes an audit event in the same transaction.
  # Workflow transitions are handled exclusively by TransitionService — not here.
  #
  # Authorization policy (enforced here, controller passes actor_role):
  #   - Commanders may update title, description, and priority.
  #   - Operators may update title and description only; priority is command-level authority.
  class UpdateService < ApplicationService
    COMMANDER_FIELDS = %w[title description priority asset_id].freeze
    OPERATOR_FIELDS  = %w[title description asset_id].freeze

    def initialize(task:, params:, actor:, actor_role: "operator")
      permitted = actor_role == "commander" ? COMMANDER_FIELDS : OPERATOR_FIELDS
      @task   = task
      @params = params.to_h.slice(*permitted)
      @actor  = actor
    end

    def call
      return ServiceResult.failure(errors: ["No updatable fields provided"]) if @params.empty?

      if @params.key?("asset_id") && @params["asset_id"].present?
        posture_error = validate_posture_allows_assignment(@params["asset_id"])
        return posture_error if posture_error
      end

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

    # Returns a ServiceResult failure if the task's AO posture forbids this assignment,
    # nil if the assignment is permitted.
    def validate_posture_allows_assignment(asset_id)
      ao = @task.site&.area_of_operation
      return nil unless ao  # no AO scoping → no posture constraint

      case ao.posture
      when "observe"
        ServiceResult.failure(errors: ["Assignment not permitted: area is in Observe posture"])
      when "defensive"
        asset = Asset.find_by(id: asset_id)
        if asset && asset.status != "available"
          ServiceResult.failure(errors: ["Assignment not permitted: Defensive posture requires an available asset (#{asset.name} is #{asset.status})"])
        end
      end
      # weapons_free: no restriction
    end
  end
end
