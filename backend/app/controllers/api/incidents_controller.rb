module Api
  class IncidentsController < BaseController
    include IncidentSerialization

    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/incidents
    # Query params: status, severity, site_id, assigned_to_id, page, per_page
    def index
      authorize Incident
      incidents = policy_scope(Incident)
        .includes(:site, :area_of_operation, :signal_rule_matches, :assigned_to, :prosecuted_by)
        .by_severity
        .recent

      incidents = incidents.for_site(params[:site_id])           if params[:site_id].present?

      if as_of
        incidents = incidents.where("created_at <= ?", as_of)
        records, meta = paginate_transformed_relation(incidents) do |batch|
          serialize_replay_incidents(batch, detailed: false, as_of: as_of).select do |record|
            replay_incident_matches_filters?(record)
          end
        end
        render json: { data: records, meta: meta }
      else
        incidents = incidents.by_status(params[:status]) if params[:status].present?
        incidents = incidents.where(severity: params[:severity]) if params[:severity].present?
        incidents = incidents.where(assigned_to_id: params[:assigned_to_id]) if params[:assigned_to_id].present?

        records, meta = paginate(incidents)
        render json: { data: records.map { |i| serialize_incident(i) }, meta: meta }
      end
    end

    # GET /api/incidents/:id
    def show
      incident = scoped_record(
        Incident,
        params[:id],
        includes: [
          :site,
          :area_of_operation,
          :assigned_to,
          :tasks,
          { signal_rule_matches: [:signal, :correlation_rule] },
        ]
      )
      authorize incident

      if as_of
        return render json: { errors: ["Incident not found"] }, status: :not_found if incident.created_at > as_of

        render json: serialize_replay_incidents([incident], detailed: true, as_of: as_of).first
      else
        render json: serialize_incident(incident, detailed: true)
      end
    end

    # PATCH /api/incidents/:id
    def update
      incident = scoped_record(Incident, params[:id], includes: [:site, :area_of_operation, :signal_rule_matches, :assigned_to])
      authorize incident
      result   = ::Incidents::UpdateService.call(
        incident: incident,
        params:   incident_params.to_h,
        actor:    current_user,
      )
      if result.success?
        render json: serialize_incident(result.incident)
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # POST /api/incidents/:id/transition
    # Body: { to_status: "acknowledged" }
    def transition
      incident  = scoped_record(Incident, params[:id], includes: [:site, :area_of_operation, :signal_rule_matches, :assigned_to])
      authorize incident, :transition?
      to_status = params[:to_status].to_s.strip

      result = ::Incidents::TransitionService.call(
        incident:  incident,
        to_status: to_status,
        actor:     current_user,
      )

      if result.success?
        render json: serialize_incident(result.incident)
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # GET /api/incidents/:id/allowed_transitions
    def allowed_transitions
      incident = scoped_record(Incident, params[:id])
      authorize incident, :allowed_transitions?
      render json: { allowed: incident.allowed_transitions }
    end

    # PATCH /api/incidents/:id/assign
    # Body: { assignee_id: "<uuid>" } — pass null/absent to unassign
    def assign
      incident = scoped_record(Incident, params[:id], includes: [:site, :area_of_operation, :signal_rule_matches, :assigned_to])
      authorize incident, :assign?
      assignee = if params[:assignee_id].present?
        user = User.find_by(id: params[:assignee_id])
        return render json: { errors: ["User not found"] }, status: :not_found unless user
        user
      end

      unless current_user.commander?
        target_id    = assignee&.id
        assignment_available = incident.assigned_to_id.nil? || incident.assigned_to_id == current_user.id
        self_assign  = target_id == current_user.id && assignment_available
        own_unassign = target_id.nil? && incident.assigned_to_id == current_user.id
        unless self_assign || own_unassign
          audit_forbidden_assignment_attempt(incident, assignee)
          return render json: { errors: ["Operators may only self-assign or release their own assignment"] },
                        status: :forbidden
        end
      end

      result = ::Incidents::AssignService.call(
        incident: incident,
        assignee: assignee,
        actor:    current_user,
      )

      if result.success?
        render json: serialize_incident(result.incident)
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # GET /api/incidents/:id/chain
    def chain
      incident = scoped_record(Incident, params[:id])
      authorize incident, :chain?
      matches  = incident.signal_rule_matches.includes(:signal, :correlation_rule, :task)
      incident_state = nil
      replay_match_states = {}
      task_snapshots = {}

      if as_of
        return render json: { errors: ["Incident not found"] }, status: :not_found if incident.created_at > as_of

        incident_state = replay_states_for_incidents([incident], as_of: as_of).fetch(incident.id)
        matches = matches.select { |match| match.fired_at <= as_of }
        replay_match_states = Replay::StateSerializer.match_states(matches, as_of: as_of)
        task_snapshots = load_replay_task_snapshots(matches.filter_map(&:task_id).uniq, as_of: as_of)
      end

      node_limit = 200
      nodes = []
      edges = []
      seen  = Set.new
      truncated = false

      nodes << {
        id:   incident.id,
        type: "incident",
        data: {
          label: incident_state ? incident_state[:title] : incident.title,
          status: incident_state ? incident_state[:status] : incident.status,
          severity: incident_state ? incident_state[:severity] : incident.severity,
        }
      }
      seen.add(incident.id)

      matches.each do |match|
        if nodes.size >= node_limit
          truncated = true
          break
        end

        unless seen.include?("match-#{match.id}")
          seen.add("match-#{match.id}")
          nodes << {
            id:   "match-#{match.id}",
            type: "alert",
            data: {
              label:      match.correlation_rule&.name || "Geofence Breach",
              status:     replay_match_states[match.id]&.dig(:workflow_status) || match.workflow_status,
              fired_at:   match.fired_at,
              confidence: match.confidence.round(2)
            }
          }
        end

        edges << {
          id:     "e-match-#{match.id}-incident",
          source: "match-#{match.id}",
          target: incident.id,
          label:  "escalated"
        }

        if match.signal
          unless seen.include?("signal-#{match.signal.id}")
            seen.add("signal-#{match.signal.id}")
            nodes << {
              id:   "signal-#{match.signal.id}",
              type: "signal",
              data: {
                label:       match.signal.signal_type.gsub("_", " ").capitalize,
                source:      match.signal.source,
                occurred_at: match.signal.occurred_at,
                lat:         match.signal.lat&.to_s,
                lng:         match.signal.lng&.to_s
              }
            }
          end

          edges << {
            id:     "e-signal-#{match.signal.id}-match-#{match.id}",
            source: "signal-#{match.signal.id}",
            target: "match-#{match.id}",
            label:  "triggered"
          }
        end

        if match.correlation_rule
          unless seen.include?("rule-#{match.correlation_rule.id}")
            seen.add("rule-#{match.correlation_rule.id}")
            nodes << {
              id:   "rule-#{match.correlation_rule.id}",
              type: "rule",
              data: { label: match.correlation_rule.name }
            }
          end

          edges << {
            id:     "e-rule-#{match.correlation_rule.id}-match-#{match.id}",
            source: "rule-#{match.correlation_rule.id}",
            target: "match-#{match.id}",
            label:  "fired"
          }
        end

        if match.task
          snapshot = task_snapshots[match.task.id]
          next if as_of && snapshot.blank?

          unless seen.include?("task-#{match.task.id}")
            seen.add("task-#{match.task.id}")
            nodes << {
              id:   "task-#{match.task.id}",
              type: "task",
              data: {
                label:    snapshot ? snapshot_value(snapshot, "title") : match.task.title,
                status:   snapshot ? snapshot_value(snapshot, "workflow_status") : match.task.workflow_status,
                priority: snapshot ? snapshot_value(snapshot, "priority") : match.task.priority
              }
            }
          end

          edges << {
            id:     "e-match-#{match.id}-task-#{match.task.id}",
            source: "match-#{match.id}",
            target: "task-#{match.task.id}",
            label:  "created"
          }
        end
      end

      render json: { nodes: nodes, edges: edges, meta: { truncated: truncated, node_count: nodes.size } }
    end

    private

    def incident_params
      params.require(:incident).permit(:title, :description, :severity)
    end

    def audit_forbidden_assignment_attempt(incident, assignee)
      snapshot = {
        assigned_to_id: incident.assigned_to_id,
        assigned_at: incident.assigned_at,
      }

      ActiveRecord::Base.transaction do
        Audit::EventWriter.write(
          actor: current_user.email,
          entity_type: "Incident",
          entity_id: incident.id,
          event_type: "incident_assignment_forbidden",
          action: "assign_forbidden",
          before_snapshot: snapshot,
          after_snapshot: snapshot,
          metadata: {
            attempted_assignee_id: assignee&.id,
            actor_role: current_user.commander? ? "commander" : "operator",
          },
          correlation_id: SecureRandom.uuid,
        )
      end
    rescue StandardError => e
      Rails.logger.error(
        "[Api::IncidentsController] failed to audit forbidden assignment " \
        "incident=#{incident.id} error=#{e.class}: #{e.message}"
      )
    end

    # ── Replay support ──────────────────────────────────────────────────────────

    def serialize_replay_incidents(records, detailed:, as_of:)
      return [] if records.empty?

      replay_states = replay_states_for_incidents(records, as_of: as_of)
      matches_by_incident = records.each_with_object({}) do |record, grouped|
        grouped[record.id] = record.signal_rule_matches.select { |match| match.fired_at <= as_of }.sort_by(&:fired_at).reverse
      end
      replay_match_states = Replay::StateSerializer.match_states(matches_by_incident.values.flatten, as_of: as_of)
      task_snapshots = load_replay_task_snapshots(
        matches_by_incident.values.flatten.filter_map(&:task_id).uniq,
        as_of: as_of
      )
      site_snapshots = latest_audit_snapshots(
        entity_type: "Site",
        entity_ids: records.filter_map(&:site_id).uniq,
        as_of: as_of
      )
      area_snapshots = latest_audit_snapshots(
        entity_type: "AreaOfOperation",
        entity_ids: records.filter_map(&:area_of_operation_id).uniq,
        as_of: as_of
      )
      rule_snapshots = if detailed
        latest_audit_snapshots(
          entity_type: "CorrelationRule",
          entity_ids: matches_by_incident.values.flatten.filter_map(&:correlation_rule_id).uniq,
          as_of: as_of
        )
      else
        {}
      end

      records.map do |record|
        matches = matches_by_incident.fetch(record.id)
        task_ids = matches.filter_map(&:task_id).uniq.select { |task_id| task_snapshots.key?(task_id) }
        serialize_incident(
          record,
          detailed: detailed,
          replay_state: replay_states.fetch(record.id),
          alert_count: matches.size,
          task_count: task_ids.size,
          site_snapshot: site_snapshots[record.site_id],
          area_snapshot: area_snapshots[record.area_of_operation_id],
          alerts: detailed ? matches.map { |match|
            serialize_alert(
              match,
              replay_state: replay_match_states[match.id],
              rule_snapshot: rule_snapshots[match.correlation_rule_id]
            )
          } : nil,
          tasks: detailed ? task_ids.filter_map { |task_id| serialize_task_snapshot(task_snapshots[task_id]) } : nil
        )
      end
    end

    def replay_incident_matches_filters?(record)
      return false if params[:status].present? && record[:status] != params[:status]
      return false if params[:severity].present? && record[:severity] != params[:severity]
      return false if params[:assigned_to_id].present? && record.dig(:assigned_to, :id) != params[:assigned_to_id]

      true
    end

    def replay_states_for_incidents(records, as_of:)
      incident_ids = records.map(&:id)
      future_events = AuditEvent
        .where(entity_type: "Incident", entity_id: incident_ids)
        .where("occurred_at > ?", as_of)
        .order(occurred_at: :desc)
      prosecution_starts = AuditEvent
        .where(entity_type: "Incident", entity_id: incident_ids, event_type: "prosecution_started")
        .where("occurred_at <= ?", as_of)
        .order(:occurred_at)
        .group_by(&:entity_id)
      future_events_by_incident = future_events.group_by(&:entity_id)

      assigned_user_ids = records.filter_map(&:assigned_to_id)
      future_events_by_incident.each_value do |events|
        events.each do |event|
          assigned_user_ids << snapshot_value(event.before_snapshot || {}, "assigned_to_id")
        end
      end
      assigned_users = User.where(id: assigned_user_ids.compact.uniq).index_by(&:id)
      users_by_email = User.where(email: prosecution_starts.values.filter_map { |events| events.last&.actor }).index_by(&:email)

      records.each_with_object({}) do |record, states|
        state = {
          title: record.title,
          description: record.description,
          severity: record.severity,
          confidence: record.confidence,
          status: record.status,
          acknowledged_at: record.acknowledged_at,
          closed_at: record.closed_at,
          assigned_to_id: record.assigned_to_id,
          assigned_at: record.assigned_at,
          prosecution_phase: record.prosecution_phase,
          fusion_rationale: nil,
        }

        future_events_by_incident.fetch(record.id, []).each do |event|
          snapshot = event.before_snapshot || {}

          %w[title description severity confidence status acknowledged_at closed_at assigned_to_id assigned_at prosecution_phase].each do |key|
            value = snapshot_value(snapshot, key)
            state[key.to_sym] = value unless value.nil? && !snapshot.key?(key) && !snapshot.key?(key.to_sym)
          end
        end

        assigned_user = assigned_users[state[:assigned_to_id]]
        prosecution_start = prosecution_starts[record.id]&.last
        prosecuted_by = users_by_email[prosecution_start&.actor]

        states[record.id] = {
          title: state[:title],
          description: state[:description],
          severity: state[:severity],
          confidence: state[:confidence],
          status: state[:status],
          acknowledged_at: state[:acknowledged_at],
          closed_at: state[:closed_at],
          fusion_rationale: state[:fusion_rationale],
          assigned_at: state[:assigned_at],
          assigned_to: assigned_user ? {
            id: assigned_user.id,
            email: assigned_user.email,
            role: assigned_user.role,
          } : nil,
          prosecution_phase: state[:prosecution_phase],
          prosecution_initiated_at: prosecution_start&.occurred_at,
          prosecuted_by: prosecuted_by ? {
            id: prosecuted_by.id,
            email: prosecuted_by.email,
          } : nil,
        }
      end
    end

    def load_replay_task_snapshots(task_ids, as_of:)
      latest_audit_snapshots(entity_type: "Task", entity_ids: task_ids, as_of: as_of)
    end
  end
end
