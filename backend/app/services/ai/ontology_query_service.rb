module Ai
  # Translates a natural-language cross-entity question into a bounded graph query
  # rooted on one operational entity, then executes that query deterministically
  # against the existing data model.
  class OntologyQueryService < ApplicationService
    include ScopedRelations

    TOOL_NAME              = "plan_ontology_query"
    BREAKER_SERVICE        = "ontology_query"
    DEFAULT_MODEL          = "claude-haiku-4-5-20251001"
    DEFAULT_WINDOW_HOURS   = 72
    MAX_WINDOW_HOURS       = 720
    DEFAULT_LIMIT          = 8
    MAX_LIMIT              = 12
    SIGNAL_RADIUS_KM       = 200.0
    ANTHROPIC_TIMEOUT_SECONDS = 30
    ANTHROPIC_MAX_RETRIES     = 2

    ROOT_TYPES = %w[site incident task asset area_of_operation].freeze
    RELATIONS_BY_ROOT = {
      "site" => %w[area incidents tasks assets alerts signals recommendations],
      "incident" => %w[site area alerts tasks signals recommendations prosecution_steps],
      "task" => %w[site asset incidents alerts recommendations],
      "asset" => %w[site tasks recommendations],
      "area_of_operation" => %w[sites incidents],
    }.freeze
    ALL_RELATIONS = RELATIONS_BY_ROOT.values.flatten.uniq.freeze

    def initialize(query:, as_of: nil, user:)
      @query = query.to_s.strip
      @as_of = as_of
      @user = user
      reset_graph!
    end

    def call
      return ServiceResult.failure(errors: ["Query cannot be blank"]) if @query.blank?
      return ServiceResult.failure(errors: ["AI temporarily unavailable. Please retry shortly."]) if Ai::CircuitBreaker.open?(service: BREAKER_SERVICE)

      plan          = plan_query
      return plan if plan.failure?

      root_type     = plan.root_type
      root_name     = plan.root_name
      time_window   = plan.time_window_hours
      upper_bound   = replay_upper_bound
      limit         = plan.limit
      relations     = normalize_relations(root_type, plan.relations)
      resolved_root = resolve_root(root_type, root_name, upper_bound: upper_bound)

      return resolved_root if resolved_root.failure?

      root = resolved_root.root
      execute_graph(root_type:, root:, relations:, limit:, time_window_hours: time_window, upper_bound: upper_bound)
      apply_replay_snapshots!(upper_bound) if @as_of.present?

      counts = build_counts
      Ai::CircuitBreaker.record_success(service: BREAKER_SERVICE)
      ServiceResult.success(
        original_query: @query,
        normalized_query: {
          root_type:         root_type,
          root_id:           root.id,
          root_label:        root_label_for(root_type, root),
          relations:         relations,
          time_window_hours: time_window,
          limit:             limit,
          as_of:             @as_of&.iso8601,
        },
        summary: build_summary(root_type:, root:, relations:, time_window_hours: time_window, counts: counts, upper_bound: upper_bound),
        nodes:    @nodes.values,
        edges:    @edges,
        counts:   counts,
      )
    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue Anthropic::Errors::APITimeoutError => e
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "Ontology query timed out", failure: "timeout")
      ServiceResult.failure(errors: ["Ontology query timed out"])
    rescue Anthropic::Errors::Error => e
      Ai::CircuitBreaker.record_failure(service: BREAKER_SERVICE)
      report_exception(e, message: "AI service error: #{e.message}", failure: "error")
      ServiceResult.failure(errors: ["AI service error: #{e.message}"])
    end

    private

    SYSTEM_PROMPT = <<~PROMPT.strip
      You are an ontology query planner for a mission operations console.
      Convert the commander's natural-language question into a single-root graph query.

      Rules:
      - Choose one root_type from the allowed enum.
      - root_name must be the exact user-visible entity name or incident title when possible.
      - Choose only relations that help answer the question.
      - If the query broadly asks what is connected to the root, choose the root's default relations.
      - Keep limit small and focused.
      - If the query does not specify a time window, leave time_window_hours null.
      - Never invent entities that are not present in the catalog.
    PROMPT

    def plan_query
      client = Anthropic::Client.new(
        api_key: ENV.fetch("ANTHROPIC_API_KEY"),
        timeout: ANTHROPIC_TIMEOUT_SECONDS,
        max_retries: ANTHROPIC_MAX_RETRIES,
      )

      ai_start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      response = client.messages.create(
        model:       ontology_model,
        max_tokens:  384,
        system:      "#{SYSTEM_PROMPT}\n\n#{catalog_context}",
        tools:       [build_tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages:    [{ role: "user", content: @query }],
      )
      Metrics::Recorder.record_ai_call(service: "ontology_query", duration_ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - ai_start) * 1000).round(1))

      tool_block = response.content.find { |block| block.type.to_s == "tool_use" && block.name == TOOL_NAME }
      return ServiceResult.failure(errors: ["AI did not return an ontology query plan"]) unless tool_block

      input = (tool_block.input || {}).with_indifferent_access
      root_type = ROOT_TYPES.include?(input["root_type"]) ? input["root_type"] : nil
      root_name = input["root_name"].to_s.strip

      return ServiceResult.failure(errors: ["AI did not identify a supported root entity"]) if root_type.blank? || root_name.blank?

      ServiceResult.success(
        root_type:         root_type,
        root_name:         root_name,
        relations:         Array(input["relations"]).filter_map { |value| value if ALL_RELATIONS.include?(value) }.uniq,
        time_window_hours: normalize_time_window(input["time_window_hours"]),
        limit:             normalize_limit(input["limit"]),
      )
    end

    def build_tool
      {
        name:        TOOL_NAME,
        description: "Plan a bounded cross-entity ontology query rooted on one known operational entity.",
        input_schema: {
          type: "object",
          properties: {
            root_type: {
              type:        "string",
              enum:        ROOT_TYPES,
              description: "Primary entity type to center the graph on.",
            },
            root_name: {
              type:        "string",
              description: "Exact site name, incident title, task title, asset name, or AO name from the catalog.",
            },
            relations: {
              type:        "array",
              items:       { type: "string", enum: ALL_RELATIONS },
              description: "Graph relations to traverse from the root. Choose only the relations needed to answer the question.",
            },
            time_window_hours: {
              type:        ["integer", "null"],
              description: "Optional recency window in hours for time-bound entities like alerts, signals, recommendations, and prosecution steps.",
            },
            limit: {
              type:        ["integer", "null"],
              description: "Maximum number of related records per relation. Keep this focused and small.",
            },
          },
          required: ["root_type", "root_name"],
        },
      }
    end

    def catalog_context
      build_catalog_context
    end

    def build_catalog_context
      [
        "Known entities:",
        "Sites: #{catalog_names(apply_replay_existence_scope(site_catalog_scope).order(:name).limit(50).pluck(:name))}",
        "Areas of operation: #{catalog_names(apply_replay_existence_scope(scoped_areas).order(:name).limit(30).pluck(:name))}",
        "Incidents: #{catalog_names(apply_replay_existence_scope(scoped_incidents(Incident.recent)).limit(40).pluck(:title))}",
        "Tasks: #{catalog_names(apply_replay_existence_scope(scoped_tasks).order(created_at: :desc).limit(40).pluck(:title))}",
        "Assets: #{catalog_names(apply_replay_existence_scope(scoped_assets).order(:name).limit(50).pluck(:name))}",
      ].join("\n")
    end

    def catalog_names(values)
      values.presence&.join(" | ") || "(none)"
    end

    def normalize_time_window(value)
      hours = value.to_i
      return DEFAULT_WINDOW_HOURS if hours <= 0

      [hours, MAX_WINDOW_HOURS].min
    end

    def normalize_limit(value)
      limit = value.to_i
      return DEFAULT_LIMIT if limit <= 0

      [limit, MAX_LIMIT].min
    end

    def normalize_relations(root_type, requested_relations)
      supported = RELATIONS_BY_ROOT.fetch(root_type, [])
      picked    = Array(requested_relations) & supported
      picked.presence || supported
    end

    def resolve_root(root_type, root_name, upper_bound:)
      scope, label_column =
        case root_type
        when "site"
          [site_root_scope, :name]
        when "incident"
          [scoped_incidents(Incident.includes(:signal_rule_matches, :site, :area_of_operation)), :title]
        when "task"
          [scoped_tasks(Task.includes(:site, :asset)), :title]
        when "asset"
          [scoped_assets(Asset.includes(:home_site)), :name]
        when "area_of_operation"
          [scoped_areas, :name]
        end

      return ServiceResult.failure(errors: ["Unsupported root entity type: #{root_type}"]) if scope.nil?

      scope = apply_replay_existence_scope(scope, upper_bound: upper_bound)
      quoted_column = scope.klass.connection.quote_column_name(label_column.to_s)

      if uuid_like?(root_name)
        record = scope.find_by(id: root_name)
        return ServiceResult.success(root: record) if record
      end

      exact = scope.where("LOWER(#{quoted_column}) = ?", root_name.downcase).limit(2).to_a
      return ServiceResult.success(root: exact.first) if exact.one?
      return ServiceResult.failure(errors: ["#{human_root_type(root_type)} name '#{root_name}' is ambiguous"]) if exact.many?

      pattern = "%#{ActiveRecord::Base.sanitize_sql_like(root_name)}%"
      partial = scope.where("#{quoted_column} ILIKE ?", pattern).limit(3).to_a
      return ServiceResult.success(root: partial.first) if partial.one?

      if partial.many?
        names = partial.map { |record| root_label_for(root_type, record) }
        return ServiceResult.failure(
          errors: ["#{human_root_type(root_type)} '#{root_name}' is ambiguous: #{names.join(', ')}"]
        )
      end

      ServiceResult.failure(errors: ["No #{human_root_type(root_type).downcase} matched '#{root_name}'"])
    end

    def execute_graph(root_type:, root:, relations:, limit:, time_window_hours:, upper_bound:)
      window_start = upper_bound - time_window_hours.hours

      case root_type
      when "site"
        build_site_graph(root, relations:, limit:, window_start:, upper_bound:)
      when "incident"
        build_incident_graph(root, relations:, limit:, window_start:, upper_bound:)
      when "task"
        build_task_graph(root, relations:, limit:, window_start:, upper_bound:)
      when "asset"
        build_asset_graph(root, relations:, limit:, window_start:, upper_bound:)
      when "area_of_operation"
        build_area_graph(root, relations:, limit:, window_start:, upper_bound:)
      else
        raise ArgumentError, "Unsupported root_type #{root_type}"
      end
    end

    def build_site_graph(site, relations:, limit:, window_start:, upper_bound:)
      site_node = add_site_node(site, root: true)
      included_targets = [["Site", site.id]]

      if relations.include?("area") && site.area_of_operation
        ao_node = add_area_node(site.area_of_operation)
        add_edge(site_node, ao_node, "in_area_of_operation")
      end

      incidents = []
      if relations.include?("incidents")
        incidents = apply_replay_existence_scope(scoped_incidents(Incident.where(site_id: site.id)), upper_bound: upper_bound)
          .includes(:site, :area_of_operation, :signal_rule_matches)
          .order(opened_at: :desc)
          .limit(limit)
        incidents.each do |incident|
          incident_node = add_incident_node(incident)
          add_edge(site_node, incident_node, "site_incident")
          included_targets << ["Incident", incident.id]
        end
      end

      tasks = []
      if relations.include?("tasks")
        tasks = apply_replay_existence_scope(scoped_tasks(Task.where(site_id: site.id)), upper_bound: upper_bound)
        tasks = tasks.includes(:asset) if relations.include?("assets")
        tasks = tasks.order(created_at: :desc).limit(limit)
        tasks.each do |task|
          task_node = add_task_node(task)
          add_edge(site_node, task_node, "site_task")
          included_targets << ["Task", task.id]

          next unless relations.include?("assets") && task.asset

          asset_node = add_asset_node(task.asset)
          add_edge(task_node, asset_node, "task_asset")
        end
      end

      if relations.include?("assets")
        apply_replay_existence_scope(scoped_assets(Asset.where(home_site_id: site.id)), upper_bound: upper_bound).order(:name).limit(limit).each do |asset|
          asset_node = add_asset_node(asset)
          add_edge(site_node, asset_node, "home_site_asset")
          included_targets << ["Asset", asset.id]
        end
      end

      alerts = []
      if relations.include?("alerts")
        alerts = scoped_alerts(SignalRuleMatch.where(site_id: site.id))
                                .where("fired_at >= ?", window_start)
                                .where("fired_at <= ?", upper_bound)
                                .includes(:task, :signal, :correlation_rule, incident: :signal_rule_matches)
                                .order(fired_at: :desc)
                                .limit(limit)
        alerts.each do |alert|
          alert_node = add_alert_node(alert)
          add_edge(site_node, alert_node, "site_alert")
          included_targets << ["SignalRuleMatch", alert.id]

          if relations.include?("incidents") && alert.incident
            incident_node = add_incident_node(alert.incident)
            add_edge(incident_node, alert_node, "incident_alert")
          end

          if relations.include?("tasks") && alert.task
            task_node = add_task_node(alert.task)
            add_edge(alert_node, task_node, "alert_task")
          end
        end
      end

      if relations.include?("signals")
        exact_signals_near_site(site, window_start:, upper_bound:, limit:).each do |signal|
          signal_node = add_signal_node(signal)
          add_edge(site_node, signal_node, "site_signal")
        end

        alerts.each do |alert|
          next unless alert.signal

          signal_node = add_signal_node(alert.signal)
          alert_node  = add_alert_node(alert)
          add_edge(alert_node, signal_node, "alert_signal")
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:, upper_bound:)
    end

    def build_incident_graph(incident, relations:, limit:, window_start:, upper_bound:)
      incident_node    = add_incident_node(incident, root: true)
      included_targets = [["Incident", incident.id]]

      if relations.include?("site") && incident.site
        site_node = add_site_node(incident.site)
        add_edge(site_node, incident_node, "site_incident")
      end

      if relations.include?("area") && incident.area_of_operation
        area_node = add_area_node(incident.area_of_operation)
        add_edge(incident_node, area_node, "incident_area_of_operation")
      end

      alerts = []
      if relations.include?("alerts")
        alerts = scoped_alerts(incident.signal_rule_matches)
                         .where("fired_at >= ?", window_start)
                         .where("fired_at <= ?", upper_bound)
                         .includes(:signal, :task, :correlation_rule)
                         .order(fired_at: :desc)
                         .limit(limit)
        alerts.each do |alert|
          alert_node = add_alert_node(alert)
          add_edge(incident_node, alert_node, "incident_alert")
          included_targets << ["SignalRuleMatch", alert.id]
        end
      end

      if relations.include?("tasks")
        apply_replay_existence_scope(scoped_tasks(incident.tasks.distinct), upper_bound: upper_bound).order(created_at: :desc).limit(limit).each do |task|
          task_node = add_task_node(task)
          add_edge(incident_node, task_node, "incident_task")
          included_targets << ["Task", task.id]
        end
      end

      if relations.include?("signals")
        incident.signals
                .where("external_signals.occurred_at >= ?", window_start)
                .where("external_signals.occurred_at <= ?", upper_bound)
                .distinct
                .order(occurred_at: :desc)
                .limit(limit)
                .each do |signal|
          signal_node = add_signal_node(signal)
          add_edge(incident_node, signal_node, "incident_signal")
        end

        alerts.each do |alert|
          next unless alert.signal

          alert_node  = add_alert_node(alert)
          signal_node = add_signal_node(alert.signal)
          add_edge(alert_node, signal_node, "alert_signal")
        end
      end

      if relations.include?("prosecution_steps")
        incident.prosecution_steps
                .where("occurred_at >= ?", window_start)
                .where("occurred_at <= ?", upper_bound)
                .includes(:actor)
                .order(occurred_at: :asc, created_at: :asc)
                .limit(limit)
                .each do |step|
          step_node = add_prosecution_step_node(step)
          add_edge(incident_node, step_node, "incident_prosecution_step")
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:, upper_bound:)
    end

    def build_task_graph(task, relations:, limit:, window_start:, upper_bound:)
      task_node        = add_task_node(task, root: true)
      included_targets = [["Task", task.id]]

      if relations.include?("site") && task.site
        site_node = add_site_node(task.site)
        add_edge(site_node, task_node, "site_task")
      end

      if relations.include?("asset") && task.asset
        asset_node = add_asset_node(task.asset)
        add_edge(task_node, asset_node, "task_asset")
        included_targets << ["Asset", task.asset.id]
      end

      alerts = []
      if relations.include?("alerts")
        alerts = scoped_alerts(SignalRuleMatch.where(task_id: task.id))
                                .includes(:signal, :correlation_rule, incident: :signal_rule_matches)
                                .where("fired_at >= ?", window_start)
                                .where("fired_at <= ?", upper_bound)
                                .order(fired_at: :desc)
                                .limit(limit)
        alerts.each do |alert|
          alert_node = add_alert_node(alert)
          add_edge(task_node, alert_node, "task_alert")
          included_targets << ["SignalRuleMatch", alert.id]

          if relations.include?("incidents") && alert.incident
            incident_node = add_incident_node(alert.incident)
            add_edge(incident_node, alert_node, "incident_alert")
            included_targets << ["Incident", alert.incident.id]
          end
        end
      end

      if relations.include?("incidents")
        scoped_incidents(Incident.joins(:signal_rule_matches))
                .where(signal_rule_matches: { task_id: task.id })
                .where("incidents.created_at <= ?", upper_bound)
                .includes(:signal_rule_matches)
                .distinct
                .order(opened_at: :desc)
                .limit(limit)
                .each do |incident|
          incident_node = add_incident_node(incident)
          add_edge(incident_node, task_node, "incident_task")
          included_targets << ["Incident", incident.id]
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:, upper_bound:)
    end

    def build_asset_graph(asset, relations:, limit:, window_start:, upper_bound:)
      asset_node       = add_asset_node(asset, root: true)
      included_targets = [["Asset", asset.id]]

      if relations.include?("site") && asset.home_site
        site_node = add_site_node(asset.home_site)
        add_edge(site_node, asset_node, "home_site_asset")
      end

      if relations.include?("tasks")
        apply_replay_existence_scope(scoped_tasks(Task.where(asset_id: asset.id)), upper_bound: upper_bound).includes(:site).order(created_at: :desc).limit(limit).each do |task|
          task_node = add_task_node(task)
          add_edge(task_node, asset_node, "task_asset")
          included_targets << ["Task", task.id]
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:, upper_bound:)
    end

    def build_area_graph(area, relations:, limit:, window_start:, upper_bound:)
      area_node        = add_area_node(area, root: true)
      included_targets = []

      sites = []
      if relations.include?("sites")
        sites = apply_replay_existence_scope(scoped_sites(Site.where(area_of_operation_id: area.id)), upper_bound: upper_bound).order(:name).limit(limit)
        sites.each do |site|
          site_node = add_site_node(site)
          add_edge(site_node, area_node, "in_area_of_operation")
          included_targets << ["Site", site.id]
        end
      end

      if relations.include?("incidents")
        apply_replay_existence_scope(scoped_incidents(Incident.where(area_of_operation_id: area.id)), upper_bound: upper_bound)
          .includes(:site, :signal_rule_matches)
          .order(opened_at: :desc)
          .limit(limit)
          .each do |incident|
          incident_node = add_incident_node(incident)
          add_edge(incident_node, area_node, "incident_area_of_operation")
          included_targets << ["Incident", incident.id]

          next unless incident.site && sites.none? { |site| site.id == incident.site_id }

          site_node = add_site_node(incident.site)
          add_edge(site_node, area_node, "in_area_of_operation")
          add_edge(site_node, incident_node, "site_incident")
        end
      end

      included_targets
    end

    def add_recommendation_nodes(targets, limit:, window_start:, upper_bound:)
      grouped = targets.group_by(&:first).transform_values { |pairs| pairs.map(&:last).uniq }
      scopes  = grouped.map do |entity_type, ids|
        Recommendation
          .where(affected_entity_type: entity_type, affected_entity_id: ids)
          .where("created_at >= ?", window_start)
          .where("created_at <= ?", upper_bound)
      end

      relation = scopes.reduce { |combined, scope| combined.or(scope) }
      return unless relation

      scoped_recommendations(relation).recent.limit(limit).each do |rec|
        rec_node = add_recommendation_node(rec)
        target_node_id = node_id_for(recommendation_target_node_type(rec), rec.affected_entity_id)
        add_edge(rec_node, target_node_id, "recommendation_target") if @nodes.key?(target_node_id)
      end
    end

    def recommendation_target_node_type(rec)
      case rec.affected_entity_type
      when "Site" then "site"
      when "Incident" then "incident"
      when "Task" then "task"
      when "Asset" then "asset"
      when "SignalRuleMatch" then "alert"
      else
        rec.affected_entity_type.to_s.underscore
      end
    end

    def exact_signals_near_site(site, window_start:, upper_bound:, limit:)
      matches    = []
      batch_size = [limit * 4, 25].max
      offset     = 0

      candidates = ExternalSignal
        .near_point(site.latitude.to_f, site.longitude.to_f, SIGNAL_RADIUS_KM)
        .where("occurred_at >= ?", window_start)
        .where("occurred_at <= ?", upper_bound)
        .order(occurred_at: :desc, id: :desc)

      loop do
        batch = candidates.offset(offset).limit(batch_size).to_a
        break if batch.empty?

        batch.each do |signal|
          next unless signal_within_radius?(signal, site)

          matches << signal
          return matches if matches.size >= limit
        end

        offset += batch.size
      end

      matches
    end

    def signal_within_radius?(signal, site)
      Correlations::EvaluatorService.haversine_km(
        signal.lat.to_f,
        signal.lng.to_f,
        site.latitude.to_f,
        site.longitude.to_f,
      ) <= SIGNAL_RADIUS_KM
    end

    def add_site_node(site, root: false)
      add_node(
        type:     "site",
        entity_id: site.id,
        label:    site.name,
        sublabel: "Site · #{site.status}",
        metadata: {
          status: site.status,
          geofence_radius_km: site.geofence_radius_km,
        },
        root:     root,
      )
    end

    def add_area_node(area, root: false)
      add_node(
        type:      "area_of_operation",
        entity_id: area.id,
        label:     area.name,
        sublabel:  "Area of operation · #{area.posture}",
        metadata:  {
          posture: area.posture,
          threat_level: area.threat_level,
        },
        root:      root,
      )
    end

    def add_incident_node(incident, root: false)
      add_node(
        type:      "incident",
        entity_id: incident.id,
        label:     incident.title,
        sublabel:  "Incident · #{incident.severity} · #{incident.status}",
        metadata:  {
          severity: incident.severity,
          status: incident.status,
          alert_count: incident.signal_rule_matches.size,
        },
        root:      root,
      )
    end

    def add_task_node(task, root: false)
      add_node(
        type:      "task",
        entity_id: task.id,
        label:     task.title,
        sublabel:  "Task · #{task.priority} · #{task.workflow_status}",
        metadata:  {
          priority: task.priority,
          workflow_status: task.workflow_status,
        },
        root:      root,
      )
    end

    def add_asset_node(asset, root: false)
      add_node(
        type:      "asset",
        entity_id: asset.id,
        label:     asset.name,
        sublabel:  "Asset · #{asset.asset_type} · #{asset.status}",
        metadata:  {
          asset_type: asset.asset_type,
          status: asset.status,
        },
        root:      root,
      )
    end

    def add_alert_node(alert, root: false)
      rule_name = alert.correlation_rule&.name || "Derived alert"
      add_node(
        type:      "alert",
        entity_id: alert.id,
        label:     rule_name,
        sublabel:  "Alert · #{alert.workflow_status} · #{(alert.confidence.to_f * 100).round}%",
        metadata:  {
          workflow_status: alert.workflow_status,
          confidence: alert.confidence.to_f.round(4),
          fired_at: alert.fired_at&.iso8601,
        },
        root:      root,
      )
    end

    def add_signal_node(signal, root: false)
      add_node(
        type:      "signal",
        entity_id: signal.id,
        label:     signal.signal_type.humanize,
        sublabel:  "Signal · #{signal.source.upcase} · #{signal.occurred_at.iso8601}",
        metadata:  {
          source: signal.source,
          signal_type: signal.signal_type,
          occurred_at: signal.occurred_at.iso8601,
        },
        root:      root,
      )
    end

    def add_recommendation_node(rec, root: false)
      add_node(
        type:      "recommendation",
        entity_id: rec.id,
        label:     rec.recommendation_type.humanize,
        sublabel:  "Recommendation · #{rec.status} · #{rec.tier}",
        metadata:  {
          recommendation_type: rec.recommendation_type,
          status: rec.status,
          tier: rec.tier,
          confidence: rec.confidence.to_f.round(4),
        },
        root:      root,
      )
    end

    def add_prosecution_step_node(step, root: false)
      add_node(
        type:      "prosecution_step",
        entity_id: step.id,
        label:     step.action_type.humanize,
        sublabel:  "Prosecution step · #{step.phase} · #{step.actor&.email || 'unknown'}",
        metadata:  {
          phase: step.phase,
          action_type: step.action_type,
          occurred_at: step.occurred_at.iso8601,
        },
        root:      root,
      )
    end

    def add_node(type:, entity_id:, label:, sublabel:, metadata:, root:)
      node_id = node_id_for(type, entity_id)
      @nodes[node_id] ||= {
        id:        node_id,
        entity_id: entity_id,
        type:      type,
        label:     label,
        sublabel:  sublabel,
        root:      root,
        metadata:  metadata.compact,
      }
      @nodes[node_id][:root] ||= root
      node_id
    end

    def add_edge(source_id, target_id, relation)
      return if source_id.blank? || target_id.blank? || source_id == target_id
      return if relation.blank?

      key = [source_id, target_id, relation].join("|")
      return if @edge_keys.include?(key)

      @edge_keys[key] = true
      @edges << { source: source_id, target: target_id, relation: relation }
    end

    def node_id_for(type, entity_id)
      "#{type}:#{entity_id}"
    end

    def site_catalog_scope
      base = @as_of.present? ? Site.all : Site.active
      scoped_sites(base)
    end

    def site_root_scope
      site_catalog_scope.includes(:area_of_operation)
    end

    def snapshot_or_current(snapshot, key, current_value)
      Replay::AuditSnapshotService.value(snapshot, key, default: current_value)
    end

    def apply_replay_snapshots!(upper_bound)
      incident_alert_counts = @edges.each_with_object(Hash.new(0)) do |edge, counts|
        next unless edge[:relation] == "incident_alert"

        incident_id = edge[:source].to_s.delete_prefix("incident:")
        counts[incident_id] += 1
      end

      apply_replay_nodes!(
        node_type: "site",
        entity_type: "Site",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        name = snapshot_or_current(snapshot, "name", record.name)
        status = snapshot_or_current(snapshot, "status", record.status)
        geofence_radius_km = snapshot_or_current(snapshot, "geofence_radius_km", record.geofence_radius_km)

        node[:label] = name
        node[:sublabel] = "Site · #{status}"
        node[:metadata] = {
          status: status,
          geofence_radius_km: geofence_radius_km,
        }.compact
      end

      apply_replay_nodes!(
        node_type: "area_of_operation",
        entity_type: "AreaOfOperation",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        name = snapshot_or_current(snapshot, "name", record.name)
        posture = snapshot_or_current(snapshot, "posture", record.posture)
        threat_level = snapshot_or_current(snapshot, "threat_level", record.threat_level)

        node[:label] = name
        node[:sublabel] = "Area of operation · #{posture}"
        node[:metadata] = {
          posture: posture,
          threat_level: threat_level,
        }.compact
      end

      apply_replay_nodes!(
        node_type: "incident",
        entity_type: "Incident",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        title = snapshot_or_current(snapshot, "title", record.title)
        severity = snapshot_or_current(snapshot, "severity", record.severity)
        status = snapshot_or_current(snapshot, "status", record.status)

        node[:label] = title
        node[:sublabel] = "Incident · #{severity} · #{status}"
        node[:metadata] = {
          severity: severity,
          status: status,
          alert_count: incident_alert_counts[record.id],
        }.compact
      end

      apply_replay_nodes!(
        node_type: "task",
        entity_type: "Task",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        title = snapshot_or_current(snapshot, "title", record.title)
        priority = snapshot_or_current(snapshot, "priority", record.priority)
        workflow_status = snapshot_or_current(snapshot, "workflow_status", record.workflow_status)

        node[:label] = title
        node[:sublabel] = "Task · #{priority} · #{workflow_status}"
        node[:metadata] = {
          priority: priority,
          workflow_status: workflow_status,
        }.compact
      end

      apply_replay_nodes!(
        node_type: "asset",
        entity_type: "Asset",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        name = snapshot_or_current(snapshot, "name", record.name)
        asset_type = snapshot_or_current(snapshot, "asset_type", record.asset_type)
        status = snapshot_or_current(snapshot, "status", record.status)

        node[:label] = name
        node[:sublabel] = "Asset · #{asset_type} · #{status}"
        node[:metadata] = {
          asset_type: asset_type,
          status: status,
        }.compact
      end

      apply_replay_nodes!(
        node_type: "alert",
        entity_type: "SignalRuleMatch",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        workflow_status = snapshot_or_current(snapshot, "workflow_status", record.workflow_status)
        rule_name = record.correlation_rule&.name || "Derived alert"

        node[:label] = rule_name
        node[:sublabel] = "Alert · #{workflow_status} · #{(record.confidence.to_f * 100).round}%"
        node[:metadata] = {
          workflow_status: workflow_status,
          confidence: record.confidence.to_f.round(4),
          fired_at: record.fired_at&.iso8601,
        }.compact
      end

      apply_replay_nodes!(
        node_type: "recommendation",
        entity_type: "Recommendation",
        upper_bound: upper_bound,
      ) do |node, record, snapshot|
        status = Replay::AuditSnapshotService.value(snapshot, "status", default: "pending")
        status = "expired" if status == "pending" && record.expires_at.present? && record.expires_at <= upper_bound

        node[:label] = record.recommendation_type.humanize
        node[:sublabel] = "Recommendation · #{status} · #{record.tier}"
        node[:metadata] = {
          recommendation_type: record.recommendation_type,
          status: status,
          tier: record.tier,
          confidence: record.confidence.to_f.round(4),
        }.compact
      end
    end

    def apply_replay_nodes!(node_type:, entity_type:, upper_bound:)
      entity_ids = @nodes.values.filter_map { |node| node[:type] == node_type ? node[:entity_id] : nil }
      return if entity_ids.empty?

      records = replay_records_for(entity_type, entity_ids, upper_bound)
      snapshots = Replay::AuditSnapshotService.call(
        entity_type: entity_type,
        entity_ids: entity_ids,
        as_of: upper_bound,
      ).snapshots

      @nodes.each_value do |node|
        next unless node[:type] == node_type

        record = records[node[:entity_id]]
        next unless record

        yield(node, record, snapshots[node[:entity_id]] || {})
      end
    end

    def replay_records_for(entity_type, entity_ids, upper_bound)
      scope =
        case entity_type
        when "Site"
          scoped_sites
        when "AreaOfOperation"
          scoped_areas
        when "Incident"
          scoped_incidents(Incident.includes(:signal_rule_matches))
        when "Task"
          scoped_tasks
        when "Asset"
          scoped_assets
        when "SignalRuleMatch"
          scoped_alerts(SignalRuleMatch.includes(:correlation_rule))
        when "Recommendation"
          scoped_recommendations
        else
          return {}
        end

      apply_replay_existence_scope(scope.where(id: entity_ids), upper_bound: upper_bound).index_by(&:id)
    end

    def apply_replay_existence_scope(scope, upper_bound: replay_upper_bound)
      return scope unless @as_of.present? && scope.klass.column_names.include?("created_at")

      scope.where("created_at <= ?", upper_bound)
    end

    def replay_upper_bound
      @as_of || Time.current
    end

    def build_counts
      by_type = @nodes.values.each_with_object(Hash.new(0)) do |node, counts|
        counts[node[:type]] += 1
      end

      {
        node_count: @nodes.size,
        edge_count: @edges.size,
        by_type:    by_type.sort.to_h,
      }
    end

    def build_summary(root_type:, root:, relations:, time_window_hours:, counts:, upper_bound:)
      related_summary = counts[:by_type]
        .reject { |type, _| type == root_type }
        .map { |type, count| "#{count} #{type.tr('_', ' ')}#{'s' unless count == 1}" }
        .join(", ")

      relation_summary = relations.map { |relation| relation.tr("_", " ") }.join(", ")

      if related_summary.present?
        "Resolved #{root_label_for(root_type, root)} as the focal #{human_root_type(root_type).downcase}. " \
          "Traversed #{relation_summary} over the last #{time_window_hours}h#{summary_cutoff_suffix(upper_bound)} and returned #{counts[:node_count]} nodes " \
          "and #{counts[:edge_count]} edges, including #{related_summary}."
      else
        "Resolved #{root_label_for(root_type, root)} as the focal #{human_root_type(root_type).downcase}. " \
          "Traversed #{relation_summary} over the last #{time_window_hours}h#{summary_cutoff_suffix(upper_bound)} and found no additional connected entities."
      end
    end

    def summary_cutoff_suffix(upper_bound)
      return "" unless @as_of.present?

      " ending at #{upper_bound.iso8601}"
    end

    def root_label_for(root_type, root)
      case root_type
      when "site", "asset", "area_of_operation"
        root.name
      when "task"
        root.title
      when "incident"
        root.title
      else
        root.respond_to?(:name) ? root.name : root.id
      end
    end

    def human_root_type(root_type)
      root_type.tr("_", " ").humanize
    end

    def uuid_like?(value)
      value.to_s.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i)
    end

    def reset_graph!
      @nodes     = {}
      @edges     = []
      @edge_keys = {}
    end

    def report_exception(exception, message:, failure:)
      Rails.logger.error("[OntologyQueryService] #{message}: #{exception.class} - #{exception.message}")
      Observability.capture_exception(
        exception,
        tags: { service: "ontology_query", failure: failure },
        extra: {
          query_length: @query.length,
          as_of_applied: @as_of.present?,
        },
        throttle_key: "ontology_query:#{failure}:#{exception.class.name}",
      )
    end

    def ontology_model
      ENV.fetch("ONTOLOGY_MODEL", DEFAULT_MODEL)
    end
  end
end
