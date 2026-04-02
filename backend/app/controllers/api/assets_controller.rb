module Api
  class AssetsController < BaseController
    before_action :require_commander!, only: [:update]
    after_action :verify_policy_scoped, only: :index

    def index
      authorize Asset
      assets = policy_scope(Asset).order(:name)
      assets = assets.where(home_site_id: params[:home_site_id]) if params[:home_site_id].present?
      assets = assets.where(status: params[:status]) if params[:status].present?
      assets = assets.where(asset_type: params[:asset_type]) if params[:asset_type].present?
      records, meta = paginate(assets)
      render json: { data: records.map { |a| serialize_asset(a) }, meta: meta }
    end

    def show
      asset = scoped_record(Asset, params[:id])
      authorize asset
      render json: serialize_asset(asset)
    end

    def update
      asset = scoped_record(Asset, params[:id])
      authorize asset
      new_status = params.require(:asset).permit(:status)[:status]

      result = Assets::StatusChangeService.new(
        asset:     asset,
        to_status: new_status,
        actor:     current_user.email
      ).call

      if result.success?
        render json: serialize_asset(result.asset)
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    private

    def serialize_asset(asset)
      asset.as_json(only: %i[id name asset_type status home_site_id last_reported_at created_at updated_at])
    end
  end
end
