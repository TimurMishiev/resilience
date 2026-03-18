module Api
  class SitesController < BaseController
    def index
      sites = Site.all.order(:name)
      sites = sites.where(status: params[:status]) if params[:status].present?
      records, meta = paginate(sites)
      render json: { data: records.map { |s| serialize_site(s) }, meta: meta }
    end

    def show
      site = Site.find(params[:id])
      render json: serialize_site(site)
    end

    def unflag
      site = Site.find(params[:id])

      unless site.flagged_at
        render json: { errors: ["Site is not flagged"] }, status: :unprocessable_entity
        return
      end

      before = site.as_json(only: %i[flagged_at flag_reason])

      ActiveRecord::Base.transaction do
        site.update!(flagged_at: nil, flag_reason: nil)

        Audit::EventWriter.write(
          actor:           current_user.email,
          entity_type:     "Site",
          entity_id:       site.id,
          event_type:      "site_unflagged",
          action:          "unflag",
          before_snapshot: before,
          after_snapshot:  site.as_json(only: %i[flagged_at flag_reason]),
          correlation_id:  SecureRandom.uuid
        )
      end

      render json: serialize_site(site)
    end

    private

    def serialize_site(site)
      site.as_json(only: %i[id name latitude longitude status area_of_operation_id flagged_at flag_reason created_at])
    end
  end
end
