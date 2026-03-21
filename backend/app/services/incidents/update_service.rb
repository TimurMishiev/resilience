module Incidents
  # Updates mutable incident attributes (title, description, severity) and
  # writes an AuditEvent in the same transaction.
  #
  # Deliberately separate from TransitionService so that a metadata edit and
  # a status transition each produce distinct, clearly labelled audit entries.
  class UpdateService < ApplicationService
    PERMITTED = %w[title description severity].freeze

    def initialize(incident:, params:, actor:)
      @incident = incident
      @params   = params.slice(*PERMITTED)
      @actor    = actor
    end

    def call
      return ServiceResult.success(incident: @incident) if @params.blank?

      before = @incident.slice(*PERMITTED)

      ActiveRecord::Base.transaction do
        @incident.update!(@params)

        Audit::EventWriter.write(
          actor:           actor_label,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "incident_updated",
          action:          "update",
          before_snapshot: before,
          after_snapshot:  @incident.slice(*PERMITTED),
          correlation_id:  SecureRandom.uuid,
        )
      end

      ServiceResult.success(incident: @incident)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error "[Incidents::UpdateService] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def actor_label
      @actor.respond_to?(:email) ? @actor.email : @actor.to_s
    end
  end
end
