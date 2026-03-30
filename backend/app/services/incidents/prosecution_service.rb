module Incidents
  # Manages the kill-chain prosecution lifecycle for an Incident.
  #
  # Prosecution is an opt-in, commander-initiated escalation that is orthogonal
  # to the incident's operational status (open/acknowledged/…).  Most incidents
  # will never be prosecuted.
  #
  # Prosecution phases (forward-only):
  #   assessing → executing → concluded
  #
  # Two operations:
  #   ProsecutionService.call(operation: :initiate, incident:, actor:, notes: nil)
  #   ProsecutionService.call(operation: :add_step,  incident:, actor:, phase:,
  #                           action_type:, notes: nil, evidence_refs: {})
  #
  # Both wrap all mutations + AuditEventWriter in a single transaction and
  # broadcast SSE after commit (never inside the transaction).
  class ProsecutionService < ApplicationService
    PHASE_ORDER = %w[assessing executing concluded].freeze

    def initialize(operation:, incident:, actor:, **kwargs)
      @operation    = operation
      @incident     = incident
      @actor        = actor
      @notes        = kwargs[:notes]
      @phase        = kwargs[:phase]
      @action_type  = kwargs[:action_type]
      @evidence_refs = kwargs.fetch(:evidence_refs, {})
    end

    def call
      case @operation
      when :initiate  then initiate
      when :add_step  then add_step
      else
        ServiceResult.failure(errors: ["Unknown operation: #{@operation}"])
      end
    end

    private

    # ── initiate ────────────────────────────────────────────────────────────────

    def initiate
      if @incident.being_prosecuted?
        return ServiceResult.failure(
          errors: ["Incident is already being prosecuted (phase: #{@incident.prosecution_phase})"]
        )
      end

      if terminal_status?
        return ServiceResult.failure(
          errors: ["Cannot initiate prosecution on a #{@incident.status} incident"]
        )
      end

      step = nil
      now  = Time.current

      ActiveRecord::Base.transaction do
        @incident.prosecution_phase          = "assessing"
        @incident.prosecuted_by_id           = @actor.id
        @incident.prosecution_initiated_at   = now
        @incident.save!

        step = ProsecutionStep.create!(
          incident:    @incident,
          actor:       @actor,
          phase:       "assessing",
          action_type: "phase_transition",
          notes:       @notes,
          evidence_refs: {},
          occurred_at: now,
        )

        Audit::EventWriter.write(
          actor:           @actor.email,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "prosecution_started",
          action:          "initiate_prosecution",
          before_snapshot: { prosecution_phase: nil },
          after_snapshot:  { prosecution_phase: "assessing", prosecuted_by: @actor.email },
          metadata:        { prosecution_step_id: step.id },
          correlation_id:  SecureRandom.uuid,
        )
      end

      begin
        Sse::Broadcaster.instance.publish(
          event: "prosecution_started",
          data:  { incident_id: @incident.id, prosecution_phase: "assessing" }
        )
      rescue StandardError => e
        Rails.logger.error "[ProsecutionService#initiate] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
      end

      ServiceResult.success(incident: @incident, step: step)
    rescue ActiveRecord::RecordInvalid => e
      msgs = e.record&.errors&.full_messages.presence || [e.message]
      ServiceResult.failure(errors: msgs)
    rescue StandardError => e
      Rails.logger.error "[ProsecutionService#initiate] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    # ── add_step ─────────────────────────────────────────────────────────────────

    def add_step
      unless @incident.being_prosecuted?
        return ServiceResult.failure(errors: ["Incident is not being prosecuted"])
      end

      unless ProsecutionStep::VALID_PHASES.include?(@phase)
        return ServiceResult.failure(errors: ["Invalid phase: #{@phase}"])
      end

      unless ProsecutionStep::VALID_ACTION_TYPES.include?(@action_type)
        return ServiceResult.failure(errors: ["Invalid action_type: #{@action_type}"])
      end

      if @action_type == "evidence_linked" && evidence_refs_empty?
        return ServiceResult.failure(errors: ["Evidence-linked steps require at least one evidence reference"])
      end

      current_idx = PHASE_ORDER.index(@incident.prosecution_phase)
      target_idx  = PHASE_ORDER.index(@phase)

      if target_idx.nil? || target_idx < current_idx
        return ServiceResult.failure(
          errors: ["Cannot set phase to '#{@phase}' — current phase is '#{@incident.prosecution_phase}'"]
        )
      end

      phase_advancing = target_idx > current_idx
      step = nil

      ActiveRecord::Base.transaction do
        if phase_advancing
          @incident.prosecution_phase = @phase
          @incident.save!
        end

        step = ProsecutionStep.create!(
          incident:      @incident,
          actor:         @actor,
          phase:         @phase,
          action_type:   @action_type,
          notes:         @notes,
          evidence_refs: @evidence_refs,
          occurred_at:   Time.current,
        )

        Audit::EventWriter.write(
          actor:           @actor.email,
          entity_type:     "Incident",
          entity_id:       @incident.id,
          event_type:      "prosecution_step_added",
          action:          "add_prosecution_step",
          before_snapshot: { prosecution_phase: phase_advancing ? PHASE_ORDER[current_idx] : @phase },
          after_snapshot:  { prosecution_phase: @phase, action_type: @action_type },
          metadata:        { prosecution_step_id: step.id, phase_advanced: phase_advancing },
          correlation_id:  SecureRandom.uuid,
        )
      end

      begin
        Sse::Broadcaster.instance.publish(
          event: "prosecution_step_added",
          data:  { incident_id: @incident.id, prosecution_phase: @incident.prosecution_phase }
        )
      rescue StandardError => e
        Rails.logger.error "[ProsecutionService#add_step] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
      end

      ServiceResult.success(incident: @incident, step: step)
    rescue ActiveRecord::RecordInvalid => e
      msgs = e.record&.errors&.full_messages.presence || [e.message]
      ServiceResult.failure(errors: msgs)
    rescue StandardError => e
      Rails.logger.error "[ProsecutionService#add_step] incident=#{@incident.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    # ── helpers ──────────────────────────────────────────────────────────────────

    def terminal_status?
      %w[resolved closed].include?(@incident.status)
    end

    def evidence_refs_empty?
      return true unless @evidence_refs.is_a?(Hash)

      @evidence_refs.values.all? do |value|
        Array(value).map(&:to_s).reject(&:blank?).empty?
      end
    end
  end
end
