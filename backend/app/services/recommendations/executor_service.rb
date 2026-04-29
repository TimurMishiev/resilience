module Recommendations
  # Maps an accepted recommendation to the appropriate backend service call.
  #
  # Execution parity principle: AI-assisted actions go through the same
  # canonical services as manual operator actions, so they receive identical
  # audit-event trails, SSE broadcasts, and validation semantics.
  #
  #   alert transitions  → Alerts::TransitionService   (audit + SSE per alert)
  #   incident transitions → inline update (same logic as IncidentsController#transition)
  #   task creation      → Tasks::CreationService      (audit event, metadata records rec ID)
  #   site flagging      → direct update + Audit::EventWriter (same as rule_firing_service)
  #   bulk triage        → loop Alerts::TransitionService   (same as bulk_transition action)
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
    rescue ActiveRecord::ActiveRecordError => e
      Rails.logger.error "[ExecutorService] #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    # Codex backlog #2 (2026-04-28): every entity referenced by an
    # action_payload must be looked up through the executing user's
    # Pundit scope, never via a bare `find_by(id:)`. Without this,
    # a poisoned action_payload (or any future generator regression
    # that lets a cross-tenant id slip into the payload) would let
    # ExecutorService call downstream services (Alerts::TransitionService,
    # Tasks::CreationService, Tasks::UpdateService,
    # Incidents::TransitionService — none of which enforce tenant
    # scope on their inputs) on entities outside the executing user's
    # tenant authority. The recommendation itself is already
    # tenant-scoped (RecommendationsController#execute uses
    # `scoped_record(Recommendation, ...)`), so payload entities must
    # share that scope.
    #
    # For an unrestricted/admin user, policy_scope returns the full
    # set so this helper is a no-op match. For an org-scoped commander,
    # it filters by tenant and returns nil for cross-tenant ids.
    def find_scoped(klass, id)
      "#{klass.name}Policy::Scope".constantize.new(@user, klass.all).resolve.find_by(id: id)
    end

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

      when "assign_asset"
        assign_asset(payload.fetch(:task_id), payload.fetch(:asset_id))

      else
        ServiceResult.failure(errors: ["Unknown recommendation type: #{@rec.recommendation_type}"])
      end
    end

    # ── Dispatchers ──────────────────────────────────────────────────────────────

    # Routes through Alerts::TransitionService — identical to the manual single-alert
    # transition path, including audit event and SSE broadcast.
    def transition_alert(alert_id, to_status)
      match = find_scoped(SignalRuleMatch, alert_id)
      return ServiceResult.failure(errors: ["Alert #{alert_id} not found"]) unless match

      Alerts::TransitionService.call(
        match:     match,
        to_status: to_status,
        actor:     @user,
        notes:     "Executed via recommendation #{@rec.id}",
      )
    end

    # Transitions an incident through the same logic as IncidentsController#transition.
    # Writes an audit event so the change is visible in the site timeline.
    def transition_incident(incident_id, to_status)
      incident = find_scoped(Incident, incident_id)
      return ServiceResult.failure(errors: ["Incident #{incident_id} not found"]) unless incident

      # Delegates to Incidents::TransitionService so audit + timestamp semantics
      # are identical whether the transition comes from operator UI or AI execution.
      Incidents::TransitionService.call(
        incident:  incident,
        to_status: to_status,
        actor:     @user,
        metadata:  { recommendation_id: @rec.id },
      )
    end

    # Routes through Tasks::CreationService — records the recommendation ID in
    # audit metadata so the AI-assisted provenance is fully traceable.
    def create_task(payload)
      site = find_scoped(Site, payload[:site_id])
      return ServiceResult.failure(errors: ["Site #{payload[:site_id]} not found for task creation"]) unless site

      Tasks::CreationService.call(
        params: {
          title:           payload.fetch(:title, "Follow-up task from recommendation"),
          priority:        payload.fetch(:priority, "normal"),
          workflow_status: "new",
          site_id:         site.id,
        },
        actor:    @user,
        metadata: { recommendation_id: @rec.id },
      )
    end

    # Flags a site using the same update + audit pattern as rule_firing_service
    # and the manual unflag controller action, so the action appears in the
    # site timeline and audit log.
    def flag_site(site_id)
      site = find_scoped(Site, site_id)
      return ServiceResult.failure(errors: ["Site #{site_id} not found"]) unless site
      return ServiceResult.success(site: site) if site.flagged_at.present?  # idempotent

      ActiveRecord::Base.transaction do
        site.update!(
          flagged_at:  Time.current,
          flag_reason: "Flagged via recommendation #{@rec.id} by #{@user.email}",
        )
        Audit::EventWriter.write(
          actor:           @user.email,
          entity_type:     "Site",
          entity_id:       site.id,
          event_type:      "site_flagged",
          action:          "flag",
          before_snapshot: { flagged_at: nil, flag_reason: nil },
          after_snapshot:  site.slice(:flagged_at, :flag_reason),
          metadata:        { recommendation_id: @rec.id },
          correlation_id:  SecureRandom.uuid,
        )
      end

      begin
        Sse::Broadcaster.instance.publish(
          event: "site_risk_updated",
          organization_id: site.organization_id,
          data:  { site_id: site.id }
        )
      rescue StandardError => e
        Rails.logger.error "[ExecutorService#flag_site] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
      end

      ServiceResult.success(site: site)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: [e.message])
    end

    # Assigns a specific asset to a task via Tasks::UpdateService, which enforces
    # posture validation and writes an audit event — same path as manual assignment.
    def assign_asset(task_id, asset_id)
      task  = find_scoped(Task, task_id)
      asset = find_scoped(Asset, asset_id)
      return ServiceResult.failure(errors: ["Task #{task_id} not found"])  unless task
      return ServiceResult.failure(errors: ["Asset #{asset_id} not found"]) unless asset

      result = Tasks::UpdateService.call(
        task:       task,
        params:     { "asset_id" => asset_id },
        actor:      @user,
        actor_role: @user.role,
      )

      if result.success?
        task.reload
        begin
          Sse::Broadcaster.instance.publish(
            event: "task_updated",
            organization_id: task.site&.organization_id,
            data:  { task_id: task.id, title: task.title, site_name: task.site&.name }
          )
        rescue StandardError => e
          Rails.logger.error "[ExecutorService#assign_asset] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
        end
      end

      result
    end

    # Bulk-triages unacknowledged alerts at a site by iterating through
    # Alerts::TransitionService — identical to the manual bulk_transition action,
    # so each alert receives its own audit event + SSE broadcast.
    def bulk_triage(site_id)
      site = find_scoped(Site, site_id)
      return ServiceResult.failure(errors: ["Site #{site_id} not found"]) unless site

      # Audit P3 (2026-04-29): preload associations Alerts::TransitionService
      # touches per-match (site, correlation_rule, signal, task). Without
      # the preload, each iteration triggered N+1 lazy loads — at 100
      # unacknowledged alerts that's 100+ extra DB roundtrips. Bulk-
      # triage was the slowest recommendation execution path; this
      # eliminates the per-match query cliff.
      matches = SignalRuleMatch
        .unacknowledged
        .includes(:site, :correlation_rule, :signal, :task)
        .where(site_id: site_id)
        .where("fired_at > ?", 24.hours.ago)

      succeeded = 0
      failed    = 0

      matches.each do |match|
        result = Alerts::TransitionService.call(
          match:     match,
          to_status: "acknowledged",
          actor:     @user,
          notes:     "Bulk triage via recommendation #{@rec.id}",
        )
        result.success? ? succeeded += 1 : failed += 1
      end

      Rails.logger.info "[ExecutorService] bulk_triage site=#{site_id} succeeded=#{succeeded} failed=#{failed}"
      ServiceResult.success(succeeded: succeeded, failed: failed)
    end
  end
end
