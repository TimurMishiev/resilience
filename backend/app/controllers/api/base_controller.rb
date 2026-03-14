module Api
  class BaseController < ApplicationController
    include JwtAuthenticatable

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
      render json: { errors: result.errors }, status: :unprocessable_entity
    end

    # Applies offset pagination to an ActiveRecord relation.
    # Returns [records, meta] where meta includes total, page, per_page, total_pages.
    # Defaults: page=1, per_page=50. Cap: per_page=200.
    def paginate(collection)
      page     = [params.fetch(:page, 1).to_i, 1].max
      per_page = [[params.fetch(:per_page, 50).to_i, 1].max, 200].min
      total    = collection.count

      records = collection.offset((page - 1) * per_page).limit(per_page)
      meta    = {
        total:       total,
        page:        page,
        per_page:    per_page,
        total_pages: (total.to_f / per_page).ceil
      }

      [records, meta]
    end
  end
end
