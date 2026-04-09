module Api
  class AssetsController < BaseController
    before_action :require_commander!, only: [:update]
    after_action :verify_policy_scoped, only: :index

    def index
      authorize Asset
      assets = policy_scope(Asset).order(:name)

      if as_of
        records, meta = paginate_transformed_relation(assets) do |batch|
          snapshots = latest_audit_snapshots(entity_type: "Asset", entity_ids: batch.map(&:id), as_of: as_of)

          batch.filter_map do |asset|
            next if asset.created_at > as_of

            serialized = serialize_asset(asset, snapshot: snapshots[asset.id], as_of: as_of)
            next unless asset_matches_filters?(serialized)

            serialized
          end
        end

        render json: { data: records, meta: meta }
        return
      end

      assets = assets.where(home_site_id: params[:home_site_id]) if params[:home_site_id].present?
      assets = assets.where(status: params[:status]) if params[:status].present?
      assets = assets.where(asset_type: params[:asset_type]) if params[:asset_type].present?
      records, meta = paginate(assets)
      render json: { data: records.map { |a| serialize_asset(a) }, meta: meta }
    end

    def show
      asset = scoped_record(Asset, params[:id])
      authorize asset

      if as_of
        return render json: { errors: ["Asset not found"] }, status: :not_found if asset.created_at > as_of

        snapshot = latest_audit_snapshots(entity_type: "Asset", entity_ids: [asset.id], as_of: as_of)[asset.id]
        render json: serialize_asset(asset, snapshot: snapshot, as_of: as_of)
      else
        render json: serialize_asset(asset)
      end
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

    def asset_matches_filters?(serialized_asset)
      return false if params[:home_site_id].present? && serialized_asset[:home_site_id].to_s != params[:home_site_id].to_s
      return false if params[:status].present? && serialized_asset[:status].to_s != params[:status].to_s
      return false if params[:asset_type].present? && serialized_asset[:asset_type].to_s != params[:asset_type].to_s

      true
    end

    def serialize_asset(asset, snapshot: nil, as_of: nil)
      clipped_last_reported_at =
        if as_of.present? && asset.last_reported_at.present? && asset.last_reported_at > as_of
          nil
        else
          asset.last_reported_at
        end

      {
        id: asset.id,
        name: snapshot_or_current(snapshot, "name", asset.name),
        asset_type: snapshot_or_current(snapshot, "asset_type", asset.asset_type),
        status: snapshot_or_current(snapshot, "status", asset.status),
        home_site_id: snapshot_or_current(snapshot, "home_site_id", asset.home_site_id),
        last_reported_at: snapshot_value(snapshot, "last_reported_at", fallback: clipped_last_reported_at),
        created_at: asset.created_at,
        updated_at: as_of.present? ? [asset.updated_at, as_of].min : asset.updated_at,
      }
    end
  end
end
