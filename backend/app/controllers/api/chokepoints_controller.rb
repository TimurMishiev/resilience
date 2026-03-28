module Api
  class ChokepointsController < BaseController
    before_action :require_commander!, only: %i[create update destroy]

    def index
      chokepoints = Chokepoint.includes(:area_of_operation).order(:name)
      chokepoints = chokepoints.where(area_of_operation_id: params[:area_of_operation_id]) if params[:area_of_operation_id].present?
      records, meta = paginate(chokepoints)
      render json: { data: records.map { |record| serialize_chokepoint(record) }, meta: meta }
    end

    def show
      chokepoint = Chokepoint.includes(:area_of_operation).find(params[:id])
      render json: serialize_chokepoint(chokepoint)
    end

    def create
      chokepoint = Chokepoint.new(chokepoint_params)
      chokepoint.created_by = current_user
      chokepoint.updated_by = current_user
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        chokepoint.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "Chokepoint",
          entity_id: chokepoint.id,
          event_type: "chokepoint.created",
          action: "create",
          before_snapshot: {},
          after_snapshot: chokepoint_snapshot(chokepoint),
          correlation_id: correlation_id
        )
      end

      broadcast_chokepoint_update(kind: "created", area_of_operation_id: chokepoint.area_of_operation_id)
      render json: serialize_chokepoint(chokepoint), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def update
      chokepoint = Chokepoint.find(params[:id])
      if area_of_operation_reassignment?(chokepoint)
        render json: { errors: ["area_of_operation_id cannot be changed"] }, status: :unprocessable_content
        return
      end

      before = chokepoint_snapshot(chokepoint)
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        chokepoint.assign_attributes(chokepoint_update_params)
        chokepoint.updated_by = current_user
        chokepoint.save!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "Chokepoint",
          entity_id: chokepoint.id,
          event_type: "chokepoint.updated",
          action: "update",
          before_snapshot: before,
          after_snapshot: chokepoint_snapshot(chokepoint),
          correlation_id: correlation_id
        )
      end

      broadcast_chokepoint_update(kind: "updated", area_of_operation_id: chokepoint.area_of_operation_id)
      render json: serialize_chokepoint(chokepoint)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def destroy
      chokepoint = Chokepoint.find(params[:id])
      before = chokepoint_snapshot(chokepoint)
      correlation_id = SecureRandom.uuid

      ApplicationRecord.transaction do
        chokepoint.destroy!
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "Chokepoint",
          entity_id: chokepoint.id,
          event_type: "chokepoint.deleted",
          action: "destroy",
          before_snapshot: before,
          after_snapshot: { deleted: true },
          correlation_id: correlation_id
        )
      end

      broadcast_chokepoint_update(kind: "deleted", area_of_operation_id: before[:area_of_operation_id])
      head :no_content
    end

    private

    def chokepoint_params
      params.require(:chokepoint).permit(
        :area_of_operation_id,
        :name,
        :category,
        :status,
        :latitude,
        :longitude,
        :watch_radius_km,
        :notes
      )
    end

    def chokepoint_update_params
      params.require(:chokepoint).permit(
        :name,
        :category,
        :status,
        :latitude,
        :longitude,
        :watch_radius_km,
        :notes
      )
    end

    def area_of_operation_reassignment?(chokepoint)
      requested_area_of_operation_id = params.dig(:chokepoint, :area_of_operation_id)
      requested_area_of_operation_id.present? && requested_area_of_operation_id != chokepoint.area_of_operation_id
    end

    def chokepoint_snapshot(chokepoint)
      {
        area_of_operation_id: chokepoint.area_of_operation_id,
        name: chokepoint.name,
        category: chokepoint.category,
        status: chokepoint.status,
        latitude: chokepoint.latitude,
        longitude: chokepoint.longitude,
        watch_radius_km: chokepoint.watch_radius_km,
        notes: chokepoint.notes,
      }
    end

    def serialize_chokepoint(chokepoint)
      {
        id: chokepoint.id,
        area_of_operation_id: chokepoint.area_of_operation_id,
        area_of_operation_name: chokepoint.area_of_operation.name,
        name: chokepoint.name,
        category: chokepoint.category,
        status: chokepoint.status,
        latitude: chokepoint.latitude.to_f,
        longitude: chokepoint.longitude.to_f,
        watch_radius_km: chokepoint.watch_radius_km.to_f,
        notes: chokepoint.notes,
        created_by_id: chokepoint.created_by_id,
        updated_by_id: chokepoint.updated_by_id,
        created_at: chokepoint.created_at,
        updated_at: chokepoint.updated_at,
      }
    end

    def broadcast_chokepoint_update(kind:, area_of_operation_id:)
      Sse::Broadcaster.instance.publish(
        event: "chokepoint_updated",
        data: {
          kind: kind,
          area_of_operation_id: area_of_operation_id,
        }
      )
    end
  end
end
