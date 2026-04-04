module Api
  class CommanderIntentsController < BaseController
    before_action :require_commander!

    def create
      intent = CommanderIntent.new(commander_intent_params)
      authorize intent, :create?
      intent.created_by = current_user
      intent.updated_by = current_user
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        intent.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "CommanderIntent",
          entity_id: intent.id,
          event_type: "commander_intent.created",
          action: "create",
          before_snapshot: {},
          after_snapshot: commander_intent_snapshot(intent),
          correlation_id: correlation_id
        )
      end

      broadcast_planning_update(kind: "commander_intent", area_of_operation_id: intent.area_of_operation_id)
      render json: serialize_commander_intent(intent), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def update
      intent = scoped_record(CommanderIntent, params[:id])
      authorize intent
      if area_of_operation_reassignment?(intent)
        render json: { errors: ["area_of_operation_id cannot be changed"] }, status: :unprocessable_content
        return
      end

      before = commander_intent_snapshot(intent)
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        intent.assign_attributes(commander_intent_update_params)
        intent.updated_by = current_user
        intent.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "CommanderIntent",
          entity_id: intent.id,
          event_type: "commander_intent.updated",
          action: "update",
          before_snapshot: before,
          after_snapshot: commander_intent_snapshot(intent),
          correlation_id: correlation_id
        )
      end

      broadcast_planning_update(kind: "commander_intent", area_of_operation_id: intent.area_of_operation_id)
      render json: serialize_commander_intent(intent)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    private

    def commander_intent_params
      params.require(:commander_intent).permit(
        :area_of_operation_id,
        :title,
        :objective,
        :end_state,
        :constraints
      )
    end

    def commander_intent_update_params
      params.require(:commander_intent).permit(
        :title,
        :objective,
        :end_state,
        :constraints
      )
    end

    def area_of_operation_reassignment?(intent)
      requested_area_of_operation_id = params.dig(:commander_intent, :area_of_operation_id)
      requested_area_of_operation_id.present? && requested_area_of_operation_id != intent.area_of_operation_id
    end

    def commander_intent_snapshot(intent)
      {
        area_of_operation_id: intent.area_of_operation_id,
        title: intent.title,
        objective: intent.objective,
        end_state: intent.end_state,
        constraints: intent.constraints,
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

    def broadcast_planning_update(kind:, area_of_operation_id:)
      ao_org_id = AreaOfOperation.where(id: area_of_operation_id).pick(:organization_id)
      Sse::Broadcaster.instance.publish(
        event: "planning_doctrine_updated",
        organization_id: ao_org_id,
        data: {
          kind: kind,
          area_of_operation_id: area_of_operation_id,
        }
      )
    end
  end
end
