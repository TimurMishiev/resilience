module Api
  class BaseController < ApplicationController
    rescue_from ActiveRecord::RecordNotFound do |e|
      render json: { errors: ["#{e.model} not found"] }, status: :not_found
    end

    rescue_from ActionController::ParameterMissing do |e|
      render json: { errors: [e.message] }, status: :bad_request
    end

    private

    # Placeholder actor until authentication is added in a later phase.
    def actor
      "api:anonymous"
    end

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
  end
end
