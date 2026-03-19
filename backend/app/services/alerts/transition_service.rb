module Alerts
  # Transitions an alert (SignalRuleMatch) through its acknowledgment workflow.
  #
  # States:     unacknowledged → acknowledged → investigating → closed
  # Re-opens:   acknowledged → unacknowledged, closed → investigating|unacknowledged
  #
  # Each transition records the acting user (acknowledged_by), the timestamp
  # (acknowledged_at), and optional operator notes. These three fields are
  # overwritten on every transition — they always reflect the *last* actor.
  # Full transition history is a Phase 2 addition via AuditEvent.
  #
  # Broadcasting
  # ------------
  # A non-transactional `alert_transitioned` SSE event is published after the
  # DB write commits, keeping the pattern consistent with RuleFiringService.
  class TransitionService < ApplicationService
    def initialize(match:, to_status:, actor:, notes: nil)
      @match     = match
      @to_status = to_status
      @actor     = actor   # User object
      @notes     = notes
    end

    def self.allowed_transitions_for(current_status)
      SignalRuleMatch::TRANSITIONS[current_status] || []
    end

    def call
      unless SignalRuleMatch::VALID_STATUSES.include?(@to_status)
        return ServiceResult.failure(errors: ["'#{@to_status}' is not a valid alert status"])
      end

      allowed = SignalRuleMatch::TRANSITIONS[@match.workflow_status] || []
      unless allowed.include?(@to_status)
        return ServiceResult.failure(
          errors: ["cannot transition alert from '#{@match.workflow_status}' to '#{@to_status}'"]
        )
      end

      @match.update!(
        workflow_status:   @to_status,
        acknowledged_by:   @actor,
        acknowledged_at:   Time.current,
        notes:             @notes
      )

      # Non-transactional broadcast — intentionally outside the update call so
      # a broadcast failure cannot roll back the DB write.
      Sse::Broadcaster.instance.publish(
        event: "alert_transitioned",
        data: {
          id:              @match.id,
          workflow_status: @match.workflow_status,
          acknowledged_by: @actor.email,
          acknowledged_at: @match.acknowledged_at.iso8601,
          notes:           @match.notes,
          rule_id:         @match.correlation_rule_id,
          rule_name:       @match.correlation_rule&.name,
          site_id:         @match.site_id,
          site_name:       @match.site&.name,
          confidence:      @match.confidence
        }
      )

      ServiceResult.success(match: @match)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    rescue StandardError => e
      Rails.logger.error "[Alerts::TransitionService] match=#{@match.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end
  end
end
