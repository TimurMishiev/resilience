module Incidents
  # Transitions an Incident through its status workflow and writes a matching
  # AuditEvent in the same transaction so the change is replayable and visible
  # in the site timeline.
  #
  # Mirrors the pattern established by Alerts::TransitionService and the site
  # controller actions: mutation + Audit::EventWriter in one transaction.
  class TransitionService < ApplicationService
    def initialize(incident:, to_status:, actor:, metadata: {})
      @incident  = incident
      @to_status = to_status
      @actor     = actor
      @metadata  = metadata
    end

    def call
      unless @incident.allowed_transitions.include?(@to_status)
        return ServiceResult.failure(
          errors: ["Cannot transition incident from '#{@incident.status}' to '#{@to_status}'"]
        )
      end

      before = snapshot(@incident)
      now    = Time.current

      @incident.status = @to_status

      # Timestamp semantics — first time only, cleared on reopen
      @incident.acknowledged_at = now if @to_status == "acknowledged" && @incident.acknowledged_at.nil?
      @incident.closed_at       = now if %w[resolved closed].include?(@to_status) && @incident.closed_at.nil?

      # Reopen clears all lifecycle timestamps so the incident can accumulate
      # fresh acknowledgement and closure data in this new open period.
      if @to_status == "open"
        @incident.acknowledged_at = nil
        @incident.closed_at       = nil
      end

      ActiveRecord::Base.transaction do
        @incident.save!

        Audit::EventWriter.write(
          actor:           actor_label,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "incident_transitioned",
          action:          "transition",
          before_snapshot: before,
          after_snapshot:  snapshot(@incident),
          metadata:        @metadata.merge(to_status: @to_status),
          correlation_id:  SecureRandom.uuid,
        )
      end

      ServiceResult.success(incident: @incident)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error "[Incidents::TransitionService] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      Observability.capture_exception(e, tags: { component: "incidents_transition" }, throttle_key: "incidents_transition:error:#{e.class}", throttle_seconds: 300)
      ServiceResult.failure(errors: [e.message])
    end

    private

    def actor_label
      @actor.respond_to?(:email) ? @actor.email : @actor.to_s
    end

    def snapshot(incident)
      incident.slice(:status, :acknowledged_at, :closed_at)
    end
  end
end
