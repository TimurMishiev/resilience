module Correlations
  # Executes the action for a matched correlation rule against a specific site.
  # Creates a Task via Tasks::CreationService, records a SignalRuleMatch, and
  # updates the rule's last_fired_at for cooldown tracking.
  class RuleFiringService < ApplicationService
    def initialize(rule:, signal:, site:)
      @rule   = rule
      @signal = signal
      @site   = site
    end

    def call
      task_attrs = build_task_attrs
      task_result = Tasks::CreationService.call(
        params: {
          site_id:     @site.id,
          title:       task_attrs[:title],
          description: task_attrs[:description],
          priority:    task_attrs[:priority]
        },
        actor:    "correlation_engine",
        metadata: {
          source:    "correlation_engine",
          rule_id:   @rule.id,
          rule_name: @rule.name,
          signal_id: @signal.id
        }
      )

      return task_result unless task_result.success

      task = task_result.payload[:task]

      match = SignalRuleMatch.create!(
        signal:           @signal,
        correlation_rule: @rule,
        site:             @site,
        task_id:          task.id,
        fired_at:         Time.current,
        metadata: {
          distance_km:  distance_to_site.round(2),
          signal_type:  @signal.signal_type,
          signal_source: @signal.source
        }
      )

      @rule.update_column(:last_fired_at, Time.current)

      ServiceResult.success(match: match, task: task)
    rescue => e
      ServiceResult.failure(errors: [e.message])
    end

    private

    def build_task_attrs
      action = @rule.actions["create_task"] || {}
      {
        title:       interpolate(action["title"].presence || "Correlation alert near #{@site.name}"),
        description: interpolate(action["description"].presence || "Rule '#{@rule.name}' fired on #{@signal.signal_type} signal from #{@signal.source}."),
        priority:    action["priority"].presence || "normal"
      }
    end

    def interpolate(str)
      str
        .gsub("{{site_name}}",    @site.name)
        .gsub("{{proximity_km}}", @rule.conditions["proximity_km"].to_s)
        .gsub("{{count}}",        @rule.conditions["count_threshold"].to_s)
        .gsub("{{signal_type}}",  @signal.signal_type)
        .gsub("{{source}}",       @signal.source)
    end

    def distance_to_site
      Correlations::EvaluatorService.haversine_km(
        @site.latitude.to_f,  @site.longitude.to_f,
        @signal.lat.to_f, @signal.lng.to_f
      )
    end
  end
end
