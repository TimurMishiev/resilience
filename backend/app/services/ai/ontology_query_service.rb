module Ai
  # Translates a natural-language cross-entity question into a bounded graph query
  # rooted on one operational entity, then executes that query deterministically
  # against the existing data model.
  class OntologyQueryService < ApplicationService
    TOOL_NAME              = "plan_ontology_query"
    DEFAULT_MODEL          = "claude-haiku-4-5-20251001"
    DEFAULT_WINDOW_HOURS   = 72
    MAX_WINDOW_HOURS       = 720
    DEFAULT_LIMIT          = 8
    MAX_LIMIT              = 12
    SIGNAL_RADIUS_KM       = 200.0
    ANTHROPIC_TIMEOUT_SECONDS = 30
    ANTHROPIC_MAX_RETRIES     = 0
    CATALOG_CACHE_KEY         = "ai/ontology_query/catalog_context/v1"
    CATALOG_CACHE_TTL         = 60.seconds

    ROOT_TYPES = %w[site incident task asset area_of_operation].freeze
    RELATIONS_BY_ROOT = {
      "site" => %w[area incidents tasks assets alerts signals recommendations],
      "incident" => %w[site area alerts tasks signals recommendations prosecution_steps],
      "task" => %w[site asset incidents alerts recommendations],
      "asset" => %w[site tasks recommendations],
      "area_of_operation" => %w[sites incidents],
    }.freeze
    ALL_RELATIONS = RELATIONS_BY_ROOT.values.flatten.uniq.freeze

    def initialize(query:)
      @query = query.to_s.strip
      reset_graph!
    end

    def call
      return ServiceResult.failure(errors: ["Query cannot be blank"]) if @query.blank?

      plan          = plan_query
      return plan if plan.failure?

      root_type     = plan.root_type
      root_name     = plan.root_name
      time_window   = plan.time_window_hours
      limit         = plan.limit
      relations     = normalize_relations(root_type, plan.relations)
      resolved_root = resolve_root(root_type, root_name)

      return resolved_root if resolved_root.failure?

      root = resolved_root.root
      execute_graph(root_type:, root:, relations:, limit:, time_window_hours: time_window)

      counts = build_counts
      ServiceResult.success(
        original_query: @query,
        normalized_query: {
          root_type:         root_type,
          root_id:           root.id,
          root_label:        root_label_for(root_type, root),
          relations:         relations,
          time_window_hours: time_window,
          limit:             limit,
        },
        summary: build_summary(root_type:, root:, relations:, time_window_hours: time_window, counts: counts),
        nodes:    @nodes.values,
        edges:    @edges,
        counts:   counts,
      )
    rescue KeyError
      ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"])
    rescue Anthropic::Errors::APITimeoutError => e
      report_exception(e, message: "Ontology query timed out", failure: "timeout")
      ServiceResult.failure(errors: ["Ontology query timed out"])
    rescue => e
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

      response = client.messages.create(
        model:       ontology_model,
        max_tokens:  384,
        system:      "#{SYSTEM_PROMPT}\n\n#{catalog_context}",
        tools:       [build_tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages:    [{ role: "user", content: @query }],
      )

      tool_block = response.content.find { |block| block.type == "tool_use" && block.name == TOOL_NAME }
      return ServiceResult.failure(errors: ["AI did not return an ontology query plan"]) unless tool_block

      input = tool_block.input || {}
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
      Rails.cache.fetch(CATALOG_CACHE_KEY, expires_in: CATALOG_CACHE_TTL) do
        build_catalog_context
      end
    end

    def build_catalog_context
      [
        "Known entities:",
        "Sites: #{catalog_names(Site.active.order(:name).limit(50).pluck(:name))}",
        "Areas of operation: #{catalog_names(AreaOfOperation.order(:name).limit(30).pluck(:name))}",
        "Incidents: #{catalog_names(Incident.recent.limit(40).pluck(:title))}",
        "Tasks: #{catalog_names(Task.order(created_at: :desc).limit(40).pluck(:title))}",
        "Assets: #{catalog_names(Asset.order(:name).limit(50).pluck(:name))}",
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

    def resolve_root(root_type, root_name)
      scope, label_column =
        case root_type
        when "site"
          [Site.active, :name]
        when "incident"
          [Incident.includes(:signal_rule_matches), :title]
        when "task"
          [Task.all, :title]
        when "asset"
          [Asset.all, :name]
        when "area_of_operation"
          [AreaOfOperation.all, :name]
        end

      return ServiceResult.failure(errors: ["Unsupported root entity type: #{root_type}"]) if scope.nil?

      if uuid_like?(root_name)
        record = scope.find_by(id: root_name)
        return ServiceResult.success(root: record) if record
      end

      exact = scope.where("LOWER(#{label_column}) = ?", root_name.downcase).limit(2).to_a
      return ServiceResult.success(root: exact.first) if exact.one?
      return ServiceResult.failure(errors: ["#{human_root_type(root_type)} name '#{root_name}' is ambiguous"]) if exact.many?

      pattern = "%#{ActiveRecord::Base.sanitize_sql_like(root_name)}%"
      partial = scope.where("#{label_column} ILIKE ?", pattern).limit(3).to_a
      return ServiceResult.success(root: partial.first) if partial.one?

      if partial.many?
        names = partial.map { |record| root_label_for(root_type, record) }
        return ServiceResult.failure(
          errors: ["#{human_root_type(root_type)} '#{root_name}' is ambiguous: #{names.join(', ')}"]
        )
      end

      ServiceResult.failure(errors: ["No #{human_root_type(root_type).downcase} matched '#{root_name}'"])
    end

    def execute_graph(root_type:, root:, relations:, limit:, time_window_hours:)
      window_start = time_window_hours.hours.ago

      case root_type
      when "site"
        build_site_graph(root, relations:, limit:, window_start:)
      when "incident"
        build_incident_graph(root, relations:, limit:, window_start:)
      when "task"
        build_task_graph(root, relations:, limit:, window_start:)
      when "asset"
        build_asset_graph(root, relations:, limit:, window_start:)
      when "area_of_operation"
        build_area_graph(root, relations:, limit:, window_start:)
      else
        raise ArgumentError, "Unsupported root_type #{root_type}"
      end
    end

    def build_site_graph(site, relations:, limit:, window_start:)
      site_node = add_site_node(site, root: true)
      included_targets = [["Site", site.id]]

      if relations.include?("area") && site.area_of_operation
        ao_node = add_area_node(site.area_of_operation)
        add_edge(site_node, ao_node, "in_area_of_operation")
      end

      incidents = []
      if relations.include?("incidents")
        incidents = Incident.where(site_id: site.id).includes(:site, :area_of_operation, :signal_rule_matches).order(opened_at: :desc).limit(limit)
        incidents.each do |incident|
          incident_node = add_incident_node(incident)
          add_edge(site_node, incident_node, "site_incident")
          included_targets << ["Incident", incident.id]
        end
      end

      tasks = []
      if relations.include?("tasks")
        tasks = Task.where(site_id: site.id).includes(:asset).order(created_at: :desc).limit(limit)
        tasks.each do |task|
          task_node = add_task_node(task)
          add_edge(site_node, task_node, "site_task")
          included_targets << ["Task", task.id]

          next unless task.asset

          asset_node = add_asset_node(task.asset)
          add_edge(task_node, asset_node, "task_asset")
        end
      end

      if relations.include?("assets")
        Asset.where(home_site_id: site.id).order(:name).limit(limit).each do |asset|
          asset_node = add_asset_node(asset)
          add_edge(site_node, asset_node, "home_site_asset")
          included_targets << ["Asset", asset.id]
        end
      end

      alerts = []
      if relations.include?("alerts")
        alerts = SignalRuleMatch.where(site_id: site.id)
                                .where("fired_at >= ?", window_start)
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
        ExternalSignal.near_point(site.latitude.to_f, site.longitude.to_f, SIGNAL_RADIUS_KM)
                      .where("occurred_at >= ?", window_start)
                      .order(occurred_at: :desc)
                      .limit(limit)
                      .each do |signal|
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

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:)
    end

    def build_incident_graph(incident, relations:, limit:, window_start:)
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
        alerts = incident.signal_rule_matches
                         .where("fired_at >= ?", window_start)
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
        incident.tasks.distinct.includes(:asset, :site).order(created_at: :desc).limit(limit).each do |task|
          task_node = add_task_node(task)
          add_edge(incident_node, task_node, "incident_task")
          included_targets << ["Task", task.id]

          next unless task.asset

          asset_node = add_asset_node(task.asset)
          add_edge(task_node, asset_node, "task_asset")
        end
      end

      if relations.include?("signals")
        incident.signals
                .where("external_signals.occurred_at >= ?", window_start)
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
                .includes(:actor)
                .order(occurred_at: :asc, created_at: :asc)
                .limit(limit)
                .each do |step|
          step_node = add_prosecution_step_node(step)
          add_edge(incident_node, step_node, "incident_prosecution_step")
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:)
    end

    def build_task_graph(task, relations:, limit:, window_start:)
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
        alerts = SignalRuleMatch.where(task_id: task.id)
                                .includes(:signal, :correlation_rule, incident: :signal_rule_matches)
                                .where("fired_at >= ?", window_start)
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

          next unless relations.include?("signals") && alert.signal

          signal_node = add_signal_node(alert.signal)
          add_edge(alert_node, signal_node, "alert_signal")
        end
      end

      if relations.include?("incidents")
        Incident.joins(:signal_rule_matches)
                .where(signal_rule_matches: { task_id: task.id })
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

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:)
    end

    def build_asset_graph(asset, relations:, limit:, window_start:)
      asset_node       = add_asset_node(asset, root: true)
      included_targets = [["Asset", asset.id]]

      if relations.include?("site") && asset.home_site
        site_node = add_site_node(asset.home_site)
        add_edge(site_node, asset_node, "home_site_asset")
      end

      if relations.include?("tasks")
        Task.where(asset_id: asset.id).includes(:site).order(created_at: :desc).limit(limit).each do |task|
          task_node = add_task_node(task)
          add_edge(task_node, asset_node, "task_asset")
          included_targets << ["Task", task.id]
        end
      end

      return unless relations.include?("recommendations")

      add_recommendation_nodes(included_targets.uniq, limit:, window_start:)
    end

    def build_area_graph(area, relations:, limit:, window_start:)
      area_node        = add_area_node(area, root: true)
      included_targets = []

      sites = []
      if relations.include?("sites")
        sites = Site.where(area_of_operation_id: area.id).order(:name).limit(limit)
        sites.each do |site|
          site_node = add_site_node(site)
          add_edge(site_node, area_node, "in_area_of_operation")
          included_targets << ["Site", site.id]
        end
      end

      if relations.include?("incidents")
        Incident.where(area_of_operation_id: area.id).includes(:site, :signal_rule_matches).order(opened_at: :desc).limit(limit).each do |incident|
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

    def add_recommendation_nodes(targets, limit:, window_start:)
      grouped = targets.group_by(&:first).transform_values { |pairs| pairs.map(&:last).uniq }
      scopes  = grouped.map do |entity_type, ids|
        Recommendation
          .where(affected_entity_type: entity_type, affected_entity_id: ids)
          .where("created_at >= ?", window_start)
      end

      relation = scopes.reduce { |combined, scope| combined.or(scope) }
      return unless relation

      relation.recent.limit(limit).each do |rec|
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

    def build_summary(root_type:, root:, relations:, time_window_hours:, counts:)
      related_summary = counts[:by_type]
        .reject { |type, _| type == root_type }
        .map { |type, count| "#{count} #{type.tr('_', ' ')}#{'s' unless count == 1}" }
        .join(", ")

      relation_summary = relations.map { |relation| relation.tr("_", " ") }.join(", ")

      if related_summary.present?
        "Resolved #{root_label_for(root_type, root)} as the focal #{human_root_type(root_type).downcase}. " \
          "Traversed #{relation_summary} over the last #{time_window_hours}h and returned #{counts[:node_count]} nodes " \
          "and #{counts[:edge_count]} edges, including #{related_summary}."
      else
        "Resolved #{root_label_for(root_type, root)} as the focal #{human_root_type(root_type).downcase}. " \
          "Traversed #{relation_summary} over the last #{time_window_hours}h and found no additional connected entities."
      end
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
        extra: { query: @query },
        throttle_key: "ontology_query:#{failure}:#{exception.class.name}",
      )
    end

    def ontology_model
      ENV.fetch("ONTOLOGY_MODEL", DEFAULT_MODEL)
    end
  end
end
