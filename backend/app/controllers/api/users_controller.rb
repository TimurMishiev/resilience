# frozen_string_literal: true

module Api
  class UsersController < BaseController
    before_action :require_commander!
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/users
    def index
      authorize User
      base = policy_scope(User).order(:email)
      records, meta = paginate(base)

      enriched = records.includes(:organization, :area_of_operation)

      render json: { data: enriched.map { |u| serialize(u) }, meta: meta }
    end

    # PATCH /api/users/:id
    def update
      user_record = scoped_record(User, params[:id])
      authorize user_record
      before = audit_snapshot(user_record)

      ApplicationRecord.transaction do
        user_record.update!(user_params)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "User",
          entity_id:       user_record.id,
          event_type:      "user_updated",
          before_snapshot: before,
          after_snapshot:  audit_snapshot(user_record),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize(user_record.reload)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    private

    def user_params
      params.require(:user).permit(:role, :organization_id, :area_of_operation_id)
    end

    def audit_snapshot(u)
      {
        email: u.email,
        role: u.role,
        organization_id: u.organization_id,
        area_of_operation_id: u.area_of_operation_id,
      }
    end

    def serialize(u)
      {
        id: u.id,
        email: u.email,
        role: u.role,
        organization_id: u.organization_id,
        organization_name: u.organization&.name,
        area_of_operation_id: u.area_of_operation_id,
        area_of_operation_name: u.area_of_operation&.name,
        created_at: u.created_at.iso8601,
        updated_at: u.updated_at.iso8601,
      }
    end
  end
end
