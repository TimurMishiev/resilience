module Api
  class OrganizationsController < BaseController
    before_action :require_commander!
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/organizations
    def index
      authorize Organization
      base = policy_scope(Organization).order(:name)
      records, meta = paginate(base)

      enriched = Organization
        .where(id: records.map(&:id))
        .left_joins(:users, :sites)
        .select("organizations.*, COUNT(DISTINCT users.id) AS cached_user_count, COUNT(DISTINCT sites.id) AS cached_site_count")
        .group("organizations.id")
        .order(:name)

      render json: { data: enriched.map { |o| serialize_indexed(o) }, meta: meta }
    end

    # GET /api/organizations/:id
    def show
      org = scoped_record(Organization, params[:id])
      authorize org
      render json: serialize(org)
    end

    # POST /api/organizations
    def create
      authorize Organization, :create?
      org = Organization.new(org_params)

      ApplicationRecord.transaction do
        org.save!

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Organization",
          entity_id:       org.id,
          event_type:      "organization_created",
          before_snapshot: nil,
          after_snapshot:  audit_snapshot(org),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize(org), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    # PATCH /api/organizations/:id
    def update
      org = scoped_record(Organization, params[:id])
      authorize org
      before = audit_snapshot(org)

      ApplicationRecord.transaction do
        org.update!(org_params)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Organization",
          entity_id:       org.id,
          event_type:      "organization_updated",
          before_snapshot: before,
          after_snapshot:  audit_snapshot(org),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize(org)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    # DELETE /api/organizations/:id
    def destroy
      org = scoped_record(Organization, params[:id], lock: true)
      authorize org

      if org.users.exists?
        return render json: { errors: ["Cannot delete organization with assigned users. Reassign users first."] },
                      status: :unprocessable_content
      end

      if org.sites.exists?
        return render json: { errors: ["Cannot delete organization with assigned sites. Reassign sites first."] },
                      status: :unprocessable_content
      end

      snapshot = audit_snapshot(org)
      ApplicationRecord.transaction do
        org.destroy!

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Organization",
          entity_id:       org.id,
          event_type:      "organization_deleted",
          before_snapshot: snapshot,
          after_snapshot:  snapshot.merge(deleted: true),
          correlation_id:  SecureRandom.uuid
        )
      end

      head :no_content
    end

    private

    def org_params
      params.require(:organization).permit(:name, :slug)
    end

    def audit_snapshot(org)
      { name: org.name, slug: org.slug }
    end

    # Used by index — reads pre-aggregated counts from the SELECT to avoid N+1.
    def serialize_indexed(org)
      org.as_json(only: %i[id name slug created_at updated_at]).merge(
        user_count: org.cached_user_count.to_i,
        site_count: org.cached_site_count.to_i
      )
    end

    # Used by show/create/update — single record, COUNT queries are fine.
    def serialize(org)
      org.as_json(only: %i[id name slug created_at updated_at]).merge(
        user_count: org.users.count,
        site_count: org.sites.count
      )
    end
  end
end
