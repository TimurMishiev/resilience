module Api
  class AreasOfOperationController < BaseController
    before_action :require_commander!, only: %i[create update destroy update_posture]
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/areas_of_operation
    def index
      authorize AreaOfOperation
      areas = policy_scope(AreaOfOperation).order(:name)

      if as_of
        records, meta = paginate_transformed_relation(areas) do |batch|
          snapshots = latest_audit_snapshots(entity_type: "AreaOfOperation", entity_ids: batch.map(&:id), as_of: as_of)

          batch.filter_map do |area|
            next if area.created_at > as_of

            serialized = serialize_area(area, snapshot: snapshots[area.id], as_of: as_of)
            next if params[:threat_level].present? && serialized[:threat_level].to_s != params[:threat_level].to_s

            serialized
          end
        end

        render json: { data: records, meta: meta }
        return
      end

      areas = areas.by_threat(params[:threat_level]) if params[:threat_level].present?
      records, meta = paginate(areas)
      render json: { data: records.map { |a| serialize_area(a) }, meta: meta }
    end

    # GET /api/areas_of_operation/:id
    def show
      area = scoped_record(AreaOfOperation, params[:id])
      authorize area

      if as_of
        return render json: { errors: ["Area of operation not found"] }, status: :not_found if area.created_at > as_of

        snapshot = latest_audit_snapshots(entity_type: "AreaOfOperation", entity_ids: [area.id], as_of: as_of)[area.id]
        render json: serialize_area(area, snapshot: snapshot, as_of: as_of)
      else
        render json: serialize_area(area)
      end
    end

    # POST /api/areas_of_operation
    def create
      authorize AreaOfOperation, :create?
      area = AreaOfOperation.new(area_params)
      area.created_by = current_user
      area.organization = current_user.organization if current_user.organization.present?

      ApplicationRecord.transaction do
        area.save!

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "AreaOfOperation",
          entity_id:       area.id,
          event_type:      "area_of_operation_created",
          before_snapshot: nil,
          after_snapshot:  audit_snapshot(area),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize_area(area), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    # PATCH /api/areas_of_operation/:id
    def update
      area = scoped_record(AreaOfOperation, params[:id])
      authorize area
      before = audit_snapshot(area)

      ApplicationRecord.transaction do
        area.update!(area_params)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "AreaOfOperation",
          entity_id:       area.id,
          event_type:      "area_of_operation_updated",
          before_snapshot: before,
          after_snapshot:  audit_snapshot(area),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize_area(area)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    # DELETE /api/areas_of_operation/:id
    def destroy
      ApplicationRecord.transaction do
        # Lock the row so concurrent doctrine-create requests cannot sneak a
        # chokepoint/intent/plan in between our attachment check and the destroy.
        area = scoped_record(AreaOfOperation, params[:id], lock: true)
        authorize area

        attached = {
          chokepoints:      area.chokepoints.count,
          commander_intent: area.commander_intent.present? ? 1 : 0,
          pace_plan:        area.pace_plan.present? ? 1 : 0,
          salute_reports:   area.salute_reports.count,
        }.reject { |_, v| v.zero? }

        if attached.any?
          details = attached.map { |k, v| "#{v} #{k.to_s.humanize.downcase}" }.join(", ")
          render json: {
            errors: ["Cannot delete AO with attached doctrine: #{details}. Remove doctrine records first."],
          }, status: :unprocessable_content
          raise ActiveRecord::Rollback
          return
        end

        snapshot = audit_snapshot(area)
        area.destroy!
        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "AreaOfOperation",
          entity_id:       area.id,
          event_type:      "area_of_operation_deleted",
          before_snapshot: snapshot,
          after_snapshot:  snapshot.merge(deleted: true),
          correlation_id:  SecureRandom.uuid
        )
      end

      head :no_content unless performed?
    end

    # PATCH /api/areas_of_operation/:id/posture
    def update_posture
      area    = scoped_record(AreaOfOperation, params[:id])
      authorize area, :update_posture?
      posture = params.require(:posture)

      unless AreaOfOperation::POSTURES.include?(posture)
        return render json: { errors: ["posture must be one of: #{AreaOfOperation::POSTURES.join(', ')}"] },
                      status: :unprocessable_content
      end

      old_posture = area.posture

      ApplicationRecord.transaction do
        area.update!(posture: posture, posture_changed_at: Time.current)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "AreaOfOperation",
          entity_id:       area.id,
          event_type:      "posture_changed",
          before_snapshot: { posture: old_posture },
          after_snapshot:  { posture: posture },
          correlation_id:  SecureRandom.uuid
        )
      end

      Sse::Broadcaster.instance.publish(
        event: "posture_changed",
        organization_id: area.organization_id,
        data:  { area_of_operation_id: area.id, name: area.name, posture: posture }
      )

      render json: serialize_area(area)
    end

    private

    def area_params
      params.require(:area_of_operation).permit(
        :name, :description, :threat_level, :color,
        geometry: {}
      )
    end

    def audit_snapshot(area)
      {
        name: area.name,
        description: area.description,
        threat_level: area.threat_level,
        posture: area.posture,
        color: area.color,
        geometry: area.geometry,
        organization_id: area.organization_id,
      }
    end

    def serialize_area(area, snapshot: nil, as_of: nil)
      {
        id: area.id,
        name: snapshot_or_current(snapshot, "name", area.name),
        description: snapshot_or_current(snapshot, "description", area.description),
        threat_level: snapshot_or_current(snapshot, "threat_level", area.threat_level),
        color: snapshot_or_current(snapshot, "color", area.color),
        posture: snapshot_or_current(snapshot, "posture", area.posture),
        posture_changed_at: snapshot_value(snapshot, "posture_changed_at", fallback: as_of.present? ? nil : area.posture_changed_at),
        organization_id: snapshot_or_current(snapshot, "organization_id", area.organization_id),
        created_at: area.created_at,
        updated_at: as_of.present? ? [area.updated_at, as_of].min : area.updated_at,
        geometry: snapshot_or_current(snapshot, "geometry", area.geometry),
        created_by_id: area.created_by_id,
      }
    end
  end
end
