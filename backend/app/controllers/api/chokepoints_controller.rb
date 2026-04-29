module Api
  class ChokepointsController < BaseController
    before_action :require_commander!, only: %i[create update destroy]
    after_action :verify_policy_scoped, only: :index

    def index
      authorize Chokepoint
      chokepoints = policy_scope(Chokepoint).includes(:area_of_operation).order(:name)
      chokepoints = chokepoints.where(area_of_operation_id: params[:area_of_operation_id]) if params[:area_of_operation_id].present?

      if as_of
        records, meta = paginate_transformed_relation(chokepoints) do |batch|
          chokepoint_snapshots = latest_audit_snapshots(entity_type: "Chokepoint", entity_ids: batch.map(&:id), as_of: as_of)
          replay_areas = build_replay_area_index_for_chokepoints(batch, chokepoint_snapshots, as_of: as_of)

          batch.filter_map do |chokepoint|
            next if chokepoint.created_at > as_of

            serialize_replay_chokepoint(
              chokepoint,
              snapshot: chokepoint_snapshots[chokepoint.id],
              replay_areas: replay_areas,
              as_of: as_of,
            )
          end
        end

        render json: { data: records, meta: meta }
        return
      end

      records, meta = paginate(chokepoints)
      render json: { data: records.map { |record| serialize_chokepoint(record) }, meta: meta }
    end

    def show
      chokepoint = scoped_record(Chokepoint, params[:id], includes: [:area_of_operation])
      authorize chokepoint

      if as_of
        return render json: { errors: ["Chokepoint not found"] }, status: :not_found if chokepoint.created_at > as_of

        snapshot = latest_audit_snapshots(entity_type: "Chokepoint", entity_ids: [chokepoint.id], as_of: as_of)[chokepoint.id]
        replay_areas = build_replay_area_index_for_chokepoints([chokepoint], { chokepoint.id => snapshot }, as_of: as_of)
        serialized = serialize_replay_chokepoint(chokepoint, snapshot: snapshot, replay_areas: replay_areas, as_of: as_of)
        return render json: { errors: ["Chokepoint not found"] }, status: :not_found if serialized.nil?

        render json: serialized
      else
        render json: serialize_chokepoint(chokepoint)
      end
    end

    def create
      chokepoint = Chokepoint.new(chokepoint_params)
      authorize chokepoint, :create?
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

      area_of_operation_name = AreaOfOperation.where(id: chokepoint.area_of_operation_id).pick(:name)

      broadcast_chokepoint_update(kind: "created", chokepoint: chokepoint, area_of_operation_name: area_of_operation_name)
      render json: serialize_chokepoint(chokepoint, area_of_operation_name: area_of_operation_name), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def update
      chokepoint = scoped_record(Chokepoint, params[:id], includes: [:area_of_operation])
      authorize chokepoint
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

      area_of_operation_name = chokepoint.area_of_operation.name

      broadcast_chokepoint_update(kind: "updated", chokepoint: chokepoint, area_of_operation_name: area_of_operation_name)
      render json: serialize_chokepoint(chokepoint, area_of_operation_name: area_of_operation_name)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def destroy
      chokepoint = scoped_record(Chokepoint, params[:id], includes: [:area_of_operation])
      authorize chokepoint
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

      broadcast_chokepoint_update(kind: "deleted", chokepoint: chokepoint, area_of_operation_name: chokepoint.area_of_operation.name)
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

    def serialize_chokepoint(chokepoint, area_of_operation_name: nil)
      {
        id: chokepoint.id,
        area_of_operation_id: chokepoint.area_of_operation_id,
        area_of_operation_name: area_of_operation_name || chokepoint.area_of_operation.name,
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

    def build_replay_area_index_for_chokepoints(chokepoints, snapshots, as_of:)
      area_ids = chokepoints.filter_map do |chokepoint|
        snapshot_or_current(snapshots[chokepoint.id], "area_of_operation_id", chokepoint.area_of_operation_id)
      end.uniq

      areas = policy_scope(AreaOfOperation).where(id: area_ids).index_by(&:id)
      area_snapshots = latest_audit_snapshots(entity_type: "AreaOfOperation", entity_ids: areas.keys, as_of: as_of)

      areas.each_with_object({}) do |(area_id, area), index|
        snapshot = area_snapshots[area_id]
        next if ActiveModel::Type::Boolean.new.cast(snapshot_value(snapshot, "deleted", fallback: nil))

        index[area_id] = {
          id: area_id,
          name: snapshot_or_current(snapshot, "name", area.name),
        }
      end
    end

    def serialize_replay_chokepoint(chokepoint, snapshot:, replay_areas:, as_of: nil)
      return nil if ActiveModel::Type::Boolean.new.cast(snapshot_value(snapshot, "deleted", fallback: nil))

      area_id = snapshot_or_current(snapshot, "area_of_operation_id", chokepoint.area_of_operation_id)
      area = replay_areas[area_id]
      return nil unless area

      {
        id: chokepoint.id,
        area_of_operation_id: area_id,
        area_of_operation_name: area[:name],
        name: snapshot_or_current(snapshot, "name", chokepoint.name),
        category: snapshot_or_current(snapshot, "category", chokepoint.category),
        status: snapshot_or_current(snapshot, "status", chokepoint.status),
        latitude: snapshot_or_current(snapshot, "latitude", chokepoint.latitude).to_f,
        longitude: snapshot_or_current(snapshot, "longitude", chokepoint.longitude).to_f,
        watch_radius_km: snapshot_or_current(snapshot, "watch_radius_km", chokepoint.watch_radius_km).to_f,
        notes: snapshot_or_current(snapshot, "notes", chokepoint.notes),
        created_by_id: chokepoint.created_by_id,
        updated_by_id: chokepoint.updated_by_id,
        created_at: chokepoint.created_at,
        # QA F3 (2026-04-28): clamp updated_at to as_of during replay.
        # See sites_controller.rb#serialize_site for the rationale.
        updated_at: as_of.present? ? [chokepoint.updated_at, as_of].min : chokepoint.updated_at,
      }
    end

    def broadcast_chokepoint_update(kind:, chokepoint:, area_of_operation_name:)
      Sse::Broadcaster.instance.publish(
        event: "chokepoint_updated",
        organization_id: chokepoint.area_of_operation&.organization_id,
        data: {
          kind:                   kind,
          chokepoint_name:        chokepoint.name,
          area_of_operation_id:   chokepoint.area_of_operation_id,
          area_of_operation_name: area_of_operation_name,
        }
      )
    end
  end
end
