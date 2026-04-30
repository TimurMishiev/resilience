module Api
  class BaseController < ApplicationController
    class InvalidDatetimeParamError < StandardError
      attr_reader :param_name

      def initialize(param_name)
        @param_name = param_name
        super("Invalid '#{param_name}' datetime")
      end
    end

    include JwtAuthenticatable
    include Pundit::Authorization
    after_action :verify_authorized
    # Defense-in-depth: replay mode is read-only. Frontend useReplayGuardedMutation
    # is the primary block; this is the backend backstop so a non-browser caller
    # (curl, automation) or a frontend regression cannot mutate live state under
    # an as_of request. Audit chain remains causally correct either way (EventWriter
    # uses Time.current), but operator intent ("I am viewing history") and server
    # effect must agree.
    before_action :reject_replay_mutations!

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

    rescue_from ActiveRecord::RecordNotFound do |_e|
      render json: { errors: ["Resource not found"] }, status: :not_found
    end

    rescue_from ActionController::ParameterMissing do |e|
      render json: { errors: [e.message] }, status: :bad_request
    end

    rescue_from ActiveRecord::StatementInvalid do |e|
      if e.cause.is_a?(PG::InvalidTextRepresentation)
        render json: { errors: ["Invalid parameter format"] }, status: :bad_request
      else
        raise
      end
    end

    rescue_from InvalidDatetimeParamError do |e|
      render json: { errors: [e.message] }, status: :bad_request
    end

    private

    def reject_replay_mutations!
      return if request.get? || request.head?
      return if params[:as_of].blank?

      # The action never runs, so Pundit's after_action verify_authorized would
      # raise AuthorizationNotPerformedError. Mark the request as having
      # performed authorization so the after_action passes.
      skip_authorization
      render json: {
        errors: ["Replay mode is read-only — mutations with as_of are not permitted"]
      }, status: :forbidden
    end

    # Parses the ?as_of= query param into a Time. Raises 400 on invalid input so
    # replay clients can never silently fall back to live data.
    def as_of
      return @parsed_as_of if instance_variable_defined?(:@parsed_as_of)

      @parsed_as_of = parse_datetime_param!(params[:as_of], param_name: "as_of")
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

    def parse_datetime_param!(value, param_name:)
      return nil if value.blank?

      Time.zone.parse(value.to_s) || raise(InvalidDatetimeParamError, param_name)
    rescue ArgumentError, TypeError
      raise InvalidDatetimeParamError, param_name
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
