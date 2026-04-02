module Api
  class PacePlansController < BaseController
    skip_after_action :verify_authorized
    before_action :require_commander!

    def create
      plan = PacePlan.new(pace_plan_params)
      plan.created_by = current_user
      plan.updated_by = current_user
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        plan.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "PacePlan",
          entity_id: plan.id,
          event_type: "pace_plan.created",
          action: "create",
          before_snapshot: {},
          after_snapshot: pace_plan_snapshot(plan),
          correlation_id: correlation_id
        )
      end

      broadcast_planning_update(kind: "pace_plan", area_of_operation_id: plan.area_of_operation_id)
      render json: serialize_pace_plan(plan), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def update
      plan = PacePlan.find(params[:id])
      if area_of_operation_reassignment?(plan)
        render json: { errors: ["area_of_operation_id cannot be changed"] }, status: :unprocessable_content
        return
      end

      before = pace_plan_snapshot(plan)
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        plan.assign_attributes(pace_plan_update_params)
        plan.updated_by = current_user
        plan.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "PacePlan",
          entity_id: plan.id,
          event_type: "pace_plan.updated",
          action: "update",
          before_snapshot: before,
          after_snapshot: pace_plan_snapshot(plan),
          correlation_id: correlation_id
        )
      end

      broadcast_planning_update(kind: "pace_plan", area_of_operation_id: plan.area_of_operation_id)
      render json: serialize_pace_plan(plan)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    private

    def pace_plan_params
      params.require(:pace_plan).permit(
        :area_of_operation_id,
        :primary_plan,
        :alternate_plan,
        :contingency_plan,
        :emergency_plan,
        :notes
      )
    end

    def pace_plan_update_params
      params.require(:pace_plan).permit(
        :primary_plan,
        :alternate_plan,
        :contingency_plan,
        :emergency_plan,
        :notes
      )
    end

    def area_of_operation_reassignment?(plan)
      requested_area_of_operation_id = params.dig(:pace_plan, :area_of_operation_id)
      requested_area_of_operation_id.present? && requested_area_of_operation_id != plan.area_of_operation_id
    end

    def pace_plan_snapshot(plan)
      {
        area_of_operation_id: plan.area_of_operation_id,
        primary_plan: plan.primary_plan,
        alternate_plan: plan.alternate_plan,
        contingency_plan: plan.contingency_plan,
        emergency_plan: plan.emergency_plan,
        notes: plan.notes,
      }
    end

    def serialize_pace_plan(plan)
      {
        id: plan.id,
        area_of_operation_id: plan.area_of_operation_id,
        primary_plan: plan.primary_plan,
        alternate_plan: plan.alternate_plan,
        contingency_plan: plan.contingency_plan,
        emergency_plan: plan.emergency_plan,
        notes: plan.notes,
        created_by_id: plan.created_by_id,
        updated_by_id: plan.updated_by_id,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
      }
    end

    def broadcast_planning_update(kind:, area_of_operation_id:)
      Sse::Broadcaster.instance.publish(
        event: "planning_doctrine_updated",
        data: {
          kind: kind,
          area_of_operation_id: area_of_operation_id,
        }
      )
    end
  end
end
