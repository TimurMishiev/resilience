module Api
  class BaseController < ApplicationController
    include JwtAuthenticatable
    include Pundit::Authorization
    after_action :verify_authorized

    # Append authenticated user_id to lograge's structured log line.
    def append_info_to_payload(payload)
      super
      payload[:user_id]   = current_user&.id
      payload[:remote_ip] = request.remote_ip
    end

    def require_commander!
      unless current_user&.commander?
        render json: { errors: ["Commander role required"] }, status: :forbidden
      end
    end

    rescue_from Pundit::NotAuthorizedError do |e|
      render json: { errors: ["Not authorized"] }, status: :forbidden
    end

    rescue_from ActiveRecord::RecordNotFound do |e|
      render json: { errors: ["#{e.model} not found"] }, status: :not_found
    end

    rescue_from ActionController::ParameterMissing do |e|
      render json: { errors: [e.message] }, status: :bad_request
    end

    private

    # Parses the ?as_of= query param into a Time. Returns nil if absent or invalid.
    def as_of
      return nil unless params[:as_of].present?

      Time.zone.parse(params[:as_of].to_s)
    rescue ArgumentError, TypeError
      nil
    end

    def render_service_failure(result)
      render json: { errors: result.errors }, status: :unprocessable_content
    end

    # Safely parses a datetime string, returning nil on any error.
    def safe_parse_datetime(value)
      return nil if value.blank?
      Time.zone.parse(value.to_s)
    rescue ArgumentError, TypeError
      nil
    end

    # Applies offset pagination to an ActiveRecord relation.
    # Returns [records, meta] where meta includes total, page, per_page, total_pages.
    # Defaults: page=1, per_page=50. Cap: per_page=200.
    def paginate(collection)
      page, per_page = pagination_params
      total    = collection.count

      records = collection.offset((page - 1) * per_page).limit(per_page)
      meta    = build_pagination_meta(total: total, page: page, per_page: per_page)

      [records, meta]
    end

    def paginate_array(collection)
      page, per_page = pagination_params
      total    = collection.size
      offset   = (page - 1) * per_page

      records = collection.slice(offset, per_page) || []
      meta    = build_pagination_meta(total: total, page: page, per_page: per_page)

      [records, meta]
    end

    # Incrementally paginates a transformed relation without materializing the
    # full record set in memory first. The block receives each ordered batch and
    # should return an array of already-filtered/serialized rows for that batch.
    def paginate_transformed_relation(relation, batch_size: nil)
      page, per_page = pagination_params
      offset         = 0
      total          = 0
      page_offset    = (page - 1) * per_page
      page_records   = []
      effective_batch_size = [[batch_size || (per_page * 2), per_page].max, 500].min

      loop do
        batch = relation.limit(effective_batch_size).offset(offset).to_a
        break if batch.empty?

        transformed = Array(yield(batch))
        transformed.each do |record|
          page_records << record if total >= page_offset && page_records.length < per_page
          total += 1
        end

        offset += batch.length
        break if batch.length < effective_batch_size
      end

      [page_records, build_pagination_meta(total: total, page: page, per_page: per_page)]
    end

    def scoped_relation(scope, includes: nil, lock: false)
      relation = policy_scope(scope)
      relation = relation.includes(*Array(includes)) if includes.present?
      relation = relation.lock if lock
      relation
    end

    def scoped_record(scope, id, includes: nil, lock: false)
      scoped_relation(scope, includes: includes, lock: lock).find(id)
    end

    def latest_audit_snapshots(entity_type:, entity_ids:, as_of:)
      Replay::AuditSnapshotService.call(
        entity_type: entity_type,
        entity_ids: entity_ids,
        as_of: as_of,
      ).snapshots
    end

    def snapshot_value(snapshot, key, fallback: nil)
      Replay::AuditSnapshotService.value(snapshot, key, default: fallback)
    end

    def snapshot_or_current(snapshot, key, current_value)
      snapshot_value(snapshot, key, fallback: current_value)
    end

    def pagination_params
      page     = [params.fetch(:page, 1).to_i, 1].max
      per_page = [[params.fetch(:per_page, 50).to_i, 1].max, 200].min
      [page, per_page]
    end

    def build_pagination_meta(total:, page:, per_page:)
      {
        total:       total,
        page:        page,
        per_page:    per_page,
        total_pages: (total.to_f / per_page).ceil
      }
    end
  end
end
