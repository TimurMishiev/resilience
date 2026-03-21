module Incidents
  # Creates an append-only operator note on an incident and writes an audit event.
  #
  # Notes are immutable — the log itself is the historical record.
  # The audit event makes the note visible in site/incident timelines.
  class NoteService < ApplicationService
    def initialize(incident:, author:, body:)
      @incident = incident
      @author   = author
      @body     = body.to_s.strip
    end

    def call
      if @body.blank?
        return ServiceResult.failure(errors: ["Note body cannot be blank"])
      end

      if @body.length > IncidentNote::MAX_BODY_LENGTH
        return ServiceResult.failure(
          errors: ["Note body cannot exceed #{IncidentNote::MAX_BODY_LENGTH} characters"]
        )
      end

      note = nil

      ActiveRecord::Base.transaction do
        note = IncidentNote.create!(
          incident: @incident,
          author:   @author,
          body:     @body,
        )

        Audit::EventWriter.write(
          actor:           @author.email,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "note_added",
          action:          "note",
          before_snapshot: {},
          after_snapshot:  {
            note_id:      note.id,
            body_preview: @body.first(120),
          },
          correlation_id:  SecureRandom.uuid,
        )
      end

      ServiceResult.success(note: note)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error "[Incidents::NoteService] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end
  end
end
