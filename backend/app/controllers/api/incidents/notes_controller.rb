module Api
  module Incidents
    class NotesController < BaseController
      include IncidentSerialization

      # GET /api/incidents/:incident_id/notes
      def index
        incident = scoped_record(Incident, params[:incident_id])
        authorize incident, :list_notes?
        notes    = incident.incident_notes.includes(:author)
        notes    = notes.where("created_at <= ?", as_of) if as_of.present?
        render json: notes.map { |n| serialize_note(n) }
      end

      # POST /api/incidents/:incident_id/notes
      def create
        incident = scoped_record(Incident, params[:incident_id])
        authorize incident, :add_note?
        result   = ::Incidents::NoteService.call(
          incident: incident,
          author:   current_user,
          body:     params[:body].to_s,
        )

        if result.success?
          render json: serialize_note(result.note), status: :created
        else
          render json: { errors: result.errors }, status: :unprocessable_content
        end
      end
    end
  end
end
