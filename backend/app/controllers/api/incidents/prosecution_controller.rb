module Api
  module Incidents
    class ProsecutionController < BaseController
      include IncidentSerialization

      # POST /api/incidents/:incident_id/prosecute
      def initiate
        incident = scoped_record(Incident, params[:incident_id])
        authorize incident, :initiate_prosecution?
        result   = ::Incidents::ProsecutionService.call(
          operation: :initiate,
          incident:  incident,
          actor:     current_user,
          notes:     params[:notes].presence,
        )

        if result.success?
          render json: serialize_incident(result.incident), status: :created
        else
          render json: { errors: result.errors }, status: :unprocessable_content
        end
      end

      # GET /api/incidents/:incident_id/prosecution_steps
      def index
        incident = scoped_record(Incident, params[:incident_id])
        authorize incident, :list_prosecution_steps?
        steps    = ProsecutionStep.for_incident(incident.id).includes(:actor)
        steps    = steps.where("occurred_at <= ?", as_of) if as_of.present?
        render json: steps.map { |s| serialize_prosecution_step(s) }
      end

      # POST /api/incidents/:incident_id/prosecution_steps
      def create
        incident = scoped_record(Incident, params[:incident_id])
        authorize incident, :add_prosecution_step?
        result   = ::Incidents::ProsecutionService.call(
          operation:     :add_step,
          incident:      incident,
          actor:         current_user,
          phase:         params[:phase].to_s,
          action_type:   params[:action_type].to_s,
          notes:         params[:notes].presence,
          evidence_refs: prosecution_step_evidence_refs,
        )

        if result.success?
          render json: serialize_prosecution_step(result.step), status: :created
        else
          render json: { errors: result.errors }, status: :unprocessable_content
        end
      end

      private

      def prosecution_step_evidence_refs
        raw = params[:evidence_refs]
        return {} unless raw.is_a?(ActionController::Parameters)

        raw.permit(signal_ids: [], match_ids: [], task_ids: [], recommendation_ids: [])
           .to_h
           .transform_values { |v| Array(v).map(&:to_s).reject(&:empty?) }
      end
    end
  end
end
