module Correlations
  # Executes all actions defined on a matched correlation rule against a specific site.
  # Supported action types (any combination may appear in rule.actions):
  #
  #   create_task   — creates a new Task at the site
  #   escalate_task — bumps priority of the most recent open task; creates one if none exists
  #   flag_site     — sets site.flagged_at and site.flag_reason
  #
  # Records a SignalRuleMatch, updates the rule's last_fired_at for cooldown tracking,
  # and broadcasts a rule_fired SSE event.
  class RuleFiringService < ApplicationService
    PRIORITY_ORDER = %w[low normal high critical].freeze

    def initialize(rule:, signal:, site:)
      @rule   = rule
      @signal = signal
      @site   = site
    end

    # Raised inside the transaction to abort when the cooldown slot is already claimed.
    CooldownActive = Class.new(StandardError)

    def call
      task          = nil
      actions_taken = []
      match         = nil

      # ── Atomic transaction: cooldown claim + all actions ─────────────────────
      # The cooldown UPDATE and all side-effects run in one transaction.
      # If any action fails the whole transaction rolls back, including the
      # last_fired_at write, so retries are not blocked by a consumed cooldown.
      # Only the first of N concurrent jobs to execute the UPDATE wins the lock;
      # the rest see rows_updated == 0 and raise CooldownActive (caught below).
      ActiveRecord::Base.transaction do
        cooldown_cutoff = @rule.cooldown_minutes.minutes.ago
        rows_updated = CorrelationRule
          .where(id: @rule.id)
          .where("last_fired_at IS NULL OR last_fired_at <= ?", cooldown_cutoff)
          .update_all(last_fired_at: Time.current)

        raise CooldownActive if rows_updated == 0

        if @rule.actions.key?("create_task")
          result = execute_create_task
          raise result.errors.first unless result.success
          task = result.payload[:task]
          actions_taken << "create_task"
        end

        if @rule.actions.key?("escalate_task")
          result = execute_escalate_task
          raise result.errors.first unless result.success
          task ||= result.payload[:task]
          actions_taken << "escalate_task"
        end

        if @rule.actions.key?("flag_site")
          result = execute_flag_site
          raise result.errors.first unless result.success
          actions_taken << "flag_site"
        end

        match = SignalRuleMatch.create!(
          signal:           @signal,
          correlation_rule: @rule,
          site:             @site,
          task_id:          task&.id,
          fired_at:         Time.current,
          metadata: {
            distance_km:   distance_to_site.round(2),
            signal_type:   @signal.signal_type,
            signal_source: @signal.source,
            actions_taken: actions_taken
          }
        )
      end

      # SSE broadcast is a non-transactional side-effect — runs after commit.
      Sse::Broadcaster.instance.publish(
        event: "rule_fired",
        data: {
          rule_id:       @rule.id,
          rule_name:     @rule.name,
          site_id:       @site.id,
          site_name:     @site.name,
          task_id:       task&.id,
          task_title:    task&.title,
          priority:      task&.priority,
          signal_type:   @signal.signal_type,
          source:        @signal.source,
          distance_km:   distance_to_site.round(1),
          fired_at:      Time.current.iso8601,
          actions_taken: actions_taken
        }
      )

      ServiceResult.success(match: match, task: task, actions_taken: actions_taken)
    rescue CooldownActive
      Rails.logger.info "[RuleFiringService] cooldown active (concurrent claim) rule=#{@rule.id} site=#{@site.id}"
      ServiceResult.failure(errors: ["cooldown"])
    rescue StandardError => e
      Rails.logger.error "[RuleFiringService] rule=#{@rule.id} signal=#{@signal.id} site=#{@site.id} error=#{e.class}: #{e.message}"
      ServiceResult.failure(errors: [e.message])
    end

    private

    # ---------------------------------------------------------------------------
    # Action handlers
    # ---------------------------------------------------------------------------

    def execute_create_task
      action = @rule.actions["create_task"]
      Tasks::CreationService.call(
        params: {
          site_id:     @site.id,
          title:       interpolate(action["title"].presence || "Correlation alert near #{@site.name}"),
          description: interpolate(action["description"].presence || "Rule '#{@rule.name}' fired on #{@signal.signal_type} signal from #{@signal.source}."),
          priority:    action["priority"].presence || "normal"
        },
        actor:    "correlation_engine",
        metadata: {
          source:    "correlation_engine",
          rule_id:   @rule.id,
          rule_name: @rule.name,
          signal_id: @signal.id
        }
      )
    end

    def execute_escalate_task
      action    = @rule.actions["escalate_task"]
      min_level = action["min_priority"].presence
      open_task = @site.tasks.where.not(workflow_status: %w[resolved]).order(created_at: :desc).first

      unless open_task
        # No open task — fall back to creating one
        return Tasks::CreationService.call(
          params: {
            site_id:  @site.id,
            title:    interpolate(action["title"].presence || "Escalation alert near #{@site.name}"),
            priority: min_level.presence || "high"
          },
          actor:    "correlation_engine",
          metadata: { source: "correlation_engine", rule_id: @rule.id, signal_id: @signal.id }
        )
      end

      new_priority = escalated_priority(open_task.priority, min_level)
      return ServiceResult.success(task: open_task) if new_priority == open_task.priority

      Tasks::UpdateService.call(
        task:   open_task,
        params: { "priority" => new_priority },
        actor:  "correlation_engine"
      )
    end

    def execute_flag_site
      action = @rule.actions["flag_site"]
      reason = interpolate(action["reason"].presence || "Rule '#{@rule.name}' flagged this site.")
      @site.update!(flagged_at: Time.current, flag_reason: reason)
      ServiceResult.success(site: @site)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end

    # ---------------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------------

    def escalated_priority(current, min_level)
      idx      = PRIORITY_ORDER.index(current) || 0
      next_idx = [idx + 1, PRIORITY_ORDER.length - 1].min
      if min_level
        min_idx = PRIORITY_ORDER.index(min_level) || 0
        PRIORITY_ORDER[[next_idx, min_idx].max]
      else
        PRIORITY_ORDER[next_idx]
      end
    end

    def interpolate(str)
      str
        .gsub("{{site_name}}",    @site.name.to_s.truncate(100))
        .gsub("{{proximity_km}}", @rule.conditions["proximity_km"].to_s)
        .gsub("{{count}}",        @rule.conditions["count_threshold"].to_s)
        .gsub("{{signal_type}}",  @signal.signal_type.to_s.truncate(50))
        .gsub("{{source}}",       @signal.source.to_s.truncate(50))
        .truncate(500)
    end

    def distance_to_site
      Correlations::EvaluatorService.haversine_km(
        @site.latitude.to_f,  @site.longitude.to_f,
        @signal.lat.to_f, @signal.lng.to_f
      )
    end
  end
end
