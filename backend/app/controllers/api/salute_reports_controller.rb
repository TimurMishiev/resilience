module Api
  class SaluteReportsController < BaseController
    before_action :require_commander!

    def create
      report = SaluteReport.new(salute_report_params)
      report.created_by = current_user
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        report.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "SaluteReport",
          entity_id: report.id,
          event_type: "salute_report.created",
          action: "create",
          before_snapshot: {},
          after_snapshot: salute_report_snapshot(report),
          correlation_id: correlation_id
        )
      end

      report = SaluteReport.includes(:area_of_operation).find(report.id)
      broadcast_planning_update(area_of_operation_id: report.area_of_operation_id)
      render json: serialize_salute_report(report), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    private

    def salute_report_params
      params.require(:salute_report).permit(
        :area_of_operation_id,
        :site_id,
        :size,
        :activity,
        :location,
        :unit,
        :observed_at,
        :equipment,
        :remarks
      )
    end

    def salute_report_snapshot(report)
      {
        area_of_operation_id: report.area_of_operation_id,
        site_id: report.site_id,
        size: report.size,
        activity: report.activity,
        location: report.location,
        unit: report.unit,
        observed_at: report.observed_at,
        equipment: report.equipment,
        remarks: report.remarks,
      }
    end

    def serialize_salute_report(report)
      {
        id: report.id,
        area_of_operation_id: report.area_of_operation_id,
        area_of_operation_name: report.area_of_operation.name,
        site_id: report.site_id,
        site_name: report.site&.name,
        size: report.size,
        activity: report.activity,
        location: report.location,
        unit: report.unit,
        observed_at: report.observed_at,
        equipment: report.equipment,
        remarks: report.remarks,
        created_by_id: report.created_by_id,
        created_at: report.created_at,
      }
    end

    def broadcast_planning_update(area_of_operation_id:)
      Sse::Broadcaster.instance.publish(
        event: "planning_doctrine_updated",
        data: {
          kind: "salute_report",
          area_of_operation_id: area_of_operation_id,
        }
      )
    end
  end
end
