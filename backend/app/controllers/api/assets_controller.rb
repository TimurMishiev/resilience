module Api
  class AssetsController < BaseController
    def index
      assets = Asset.all.order(:name)
      assets = assets.where(home_site_id: params[:home_site_id]) if params[:home_site_id].present?
      assets = assets.where(status: params[:status]) if params[:status].present?
      assets = assets.where(asset_type: params[:asset_type]) if params[:asset_type].present?
      records, meta = paginate(assets)
      render json: { data: records.map { |a| serialize_asset(a) }, meta: meta }
    end

    def show
      asset = Asset.find(params[:id])
      render json: serialize_asset(asset)
    end

    private

    def serialize_asset(asset)
      asset.as_json(only: %i[id name asset_type status home_site_id created_at])
    end
  end
end
