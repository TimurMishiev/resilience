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

    private

    def serialize_site(site)
      site.as_json(only: %i[id name latitude longitude status area_of_operation_id flagged_at flag_reason created_at])
    end
  end
end
