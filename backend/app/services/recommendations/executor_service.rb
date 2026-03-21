module Recommendations
  # Maps an accepted recommendation to the appropriate backend service call.
  # Returns a ServiceResult. On success, marks the recommendation as executed.
  class ExecutorService < ApplicationService
    def initialize(recommendation:, user:)
      @rec  = recommendation
      @user = user
    end

    def call
      return ServiceResult.failure(errors: ["Recommendation is not accepted"]) unless @rec.accepted?

      result = dispatch
      if result.success?
        @rec.mark_executed!
        Rails.logger.info "[ExecutorService] executed rec=#{@rec.id} type=#{@rec.recommendation_type} by user=#{@user.id}"
      else
        Rails.logger.warn "[ExecutorService] dispatch failed rec=#{@rec.id}: #{result.errors.join(', ')}"
      end
      result
    rescue => e
      Rails.logger.error "[ExecutorService] #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    def dispatch
      payload = @rec.action_payload.with_indifferent_access
      case @rec.recommendation_type
      when "close_stale_alert"
        transition_alert(payload.fetch(:alert_id), "closed")

      when "acknowledge_alert"
        transition_alert(payload.fetch(:alert_id), "acknowledged")

      when "escalate_incident"
        transition_incident(payload.fetch(:incident_id), payload.fetch(:to_status, "acknowledged"))

      when "create_task"
        create_task(payload)

      when "flag_site"
        flag_site(payload.fetch(:site_id))

      when "bulk_triage_alerts"
        bulk_triage(payload.fetch(:site_id))

      else
        ServiceResult.failure(errors: ["Unknown recommendation type: #{@rec.recommendation_type}"])
      end
    end

    # ── Dispatchers ──────────────────────────────────────────────────────────────

    def transition_alert(alert_id, to_status)
      match = SignalRuleMatch.find_by(id: alert_id)
      return ServiceResult.failure(errors: ["Alert #{alert_id} not found"]) unless match

      allowed = SignalRuleMatch::TRANSITIONS[match.workflow_status] || []
      return ServiceResult.failure(errors: ["Transition to #{to_status} not allowed from #{match.workflow_status}"]) \
        unless allowed.include?(to_status)

      match.update!(workflow_status: to_status, acknowledged_by: @user, acknowledged_at: Time.current)
      ServiceResult.success(match: match)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: [e.message])
    end

    def transition_incident(incident_id, to_status)
      incident = Incident.find_by(id: incident_id)
      return ServiceResult.failure(errors: ["Incident #{incident_id} not found"]) unless incident

      allowed = incident.allowed_transitions
      return ServiceResult.failure(errors: ["Transition to #{to_status} not allowed"]) \
        unless allowed.include?(to_status)

      ts_fields = {}
      ts_fields[:acknowledged_at] = Time.current if to_status == "acknowledged" && incident.acknowledged_at.nil?
      ts_fields[:closed_at]       = Time.current if %w[resolved closed].include?(to_status)

      incident.update!(status: to_status, **ts_fields)
      ServiceResult.success(incident: incident)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: [e.message])
    end

    def create_task(payload)
      site = Site.find_by(id: payload[:site_id])
      return ServiceResult.failure(errors: ["Site #{payload[:site_id]} not found for task creation"]) unless site

      task = Task.create!(
        title:           payload.fetch(:title, "Follow-up task from recommendation"),
        priority:        payload.fetch(:priority, "normal"),
        workflow_status: "new",
        site:            site,
      )
      ServiceResult.success(task: task)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: [e.message])
    end

    def flag_site(site_id)
      site = Site.find_by(id: site_id)
      return ServiceResult.failure(errors: ["Site #{site_id} not found"]) unless site

      site.update!(flagged_at: Time.current)
      ServiceResult.success(site: site)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: [e.message])
    end

    def bulk_triage(site_id)
      site = Site.find_by(id: site_id)
      return ServiceResult.failure(errors: ["Site #{site_id} not found"]) unless site

      count = SignalRuleMatch
        .unacknowledged
        .where(site_id: site_id)
        .where("fired_at > ?", 24.hours.ago)
        .update_all(workflow_status: "acknowledged", acknowledged_at: Time.current, acknowledged_by_id: @user.id)

      ServiceResult.success(count: count)
    end
  end
end
