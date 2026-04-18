module Incidents
  # Assigns (or unassigns) an incident to a user and writes an audit event.
  #
  # This service is intentionally role-agnostic — it assigns or clears the
  # assignment without checking the caller's role.  Authorization (operators may
  # only self-assign or release their own assignment; commanders can assign
  # anyone) is enforced at the controller boundary, not here.
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
      unless assignee_compatible_with_incident_scope?
        return ServiceResult.failure(errors: ["Assignee is not eligible for this incident"])
      end

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
      Observability.capture_exception(e, tags: { component: "incidents_assign" }, throttle_key: "incidents_assign:error:#{e.class}", throttle_seconds: 300)
      ServiceResult.failure(errors: [e.message])
    end

    private

    def actor_label
      @actor.respond_to?(:email) ? @actor.email : @actor.to_s
    end

    def assignee_compatible_with_incident_scope?
      return true unless @assignee.present?

      incident_org_id = @incident.site&.organization_id || @incident.area_of_operation&.organization_id
      incident_ao_id  = @incident.site&.area_of_operation_id || @incident.area_of_operation_id

      return false if incident_org_id.present? && @assignee.organization_id != incident_org_id
      return false if incident_ao_id.present? && @assignee.area_of_operation_id.present? && @assignee.area_of_operation_id != incident_ao_id

      true
    end
  end
end
