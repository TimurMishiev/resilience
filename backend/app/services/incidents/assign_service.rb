module Incidents
  # Assigns (or unassigns) an incident to a user and writes an audit event.
  #
  # Any authenticated user may assign any incident — this is intentional for
  # operational speed.  Commanders can reassign; operators can self-assign.
  # The audit trail records every assignment change.
  #
  # Pass assignee: nil to clear the assignment.
  class AssignService < ApplicationService
    def initialize(incident:, assignee:, actor:)
      @incident = incident
      @assignee = assignee
      @actor    = actor
    end

    def call
      before = {
        assigned_to_id: @incident.assigned_to_id,
        assigned_at:    @incident.assigned_at,
      }

      ActiveRecord::Base.transaction do
        @incident.update!(
          assigned_to_id: @assignee&.id,
          assigned_at:    @assignee.present? ? Time.current : nil,
        )

        Audit::EventWriter.write(
          actor:           actor_label,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "incident_assigned",
          action:          "assign",
          before_snapshot: before,
          after_snapshot:  {
            assigned_to_id: @incident.assigned_to_id,
            assigned_at:    @incident.assigned_at,
          },
          metadata:        { assignee_email: @assignee&.email },
          correlation_id:  SecureRandom.uuid,
        )
      end

      ServiceResult.success(incident: @incident)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error "[Incidents::AssignService] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def actor_label
      @actor.respond_to?(:email) ? @actor.email : @actor.to_s
    end
  end
end
