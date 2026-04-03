module Api
  class IncidentsController < BaseController
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
      incident = scoped_record(Incident, params[:id])
      authorize incident
      result   = Incidents::UpdateService.call(
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
      incident  = scoped_record(Incident, params[:id])
      authorize incident, :transition?
      to_status = params[:to_status].to_s.strip

      result = Incidents::TransitionService.call(
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
    #
    # Authorization:
    #   Commanders  — may assign any incident to any user (or clear any assignment)
    #   Operators   — may only self-assign, or release their own assignment;
    #                 any attempt to assign to a different user returns 403
    def assign
      incident = scoped_record(Incident, params[:id])
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

      result = Incidents::AssignService.call(
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
    # Returns the directed graph of nodes and edges that form this incident's
    # intelligence chain: Signals → Rules → Alerts → Incident + Tasks.
    # Nodes are deduplicated — a rule or signal shared across multiple alerts
    # appears only once.  The frontend assigns layout positions.
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
        replay_match_states = replay_states_for_matches(matches, as_of: as_of)
        task_snapshots = load_replay_task_snapshots(matches.filter_map(&:task_id).uniq, as_of: as_of)
      end

      nodes = []
      edges = []
      seen  = Set.new

      # Incident node (always present — anchor of the graph)
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
        # Alert node
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

        # Signal node + edge
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

        # Rule node + edge (geofence breaches have no rule)
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

        # Task node + edge (one per match at most)
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

      render json: { nodes: nodes, edges: edges }
    end

    # POST /api/incidents/:id/prosecute
    # Initiates kill-chain prosecution on an incident (commander-only).
    # Body: { notes: "..." }  (optional)
    def initiate_prosecution
      incident = scoped_record(Incident, params[:id])
      authorize incident, :initiate_prosecution?
      result   = Incidents::ProsecutionService.call(
        operation: :initiate,
        incident:  incident,
        actor:     current_user,
        notes:     params[:notes].presence,
      )

      if result.success?
        render json: serialize_incident(result.incident), status: :created
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # GET /api/incidents/:id/prosecution_steps
    def list_prosecution_steps
      incident = scoped_record(Incident, params[:id])
      authorize incident, :list_prosecution_steps?
      steps    = ProsecutionStep.for_incident(incident.id).includes(:actor)
      steps    = steps.where("occurred_at <= ?", as_of) if as_of.present?
      render json: steps.map { |s| serialize_prosecution_step(s) }
    end

    # POST /api/incidents/:id/prosecution_steps
    # Body: { phase:, action_type:, notes:, evidence_refs: { signal_ids: [], ... } }
    def add_prosecution_step
      incident = scoped_record(Incident, params[:id])
      authorize incident, :add_prosecution_step?
      result   = Incidents::ProsecutionService.call(
        operation:     :add_step,
        incident:      incident,
        actor:         current_user,
        phase:         params[:phase].to_s,
        action_type:   params[:action_type].to_s,
        notes:         params[:notes].presence,
        evidence_refs: prosecution_step_evidence_refs,
      )

      if result.success?
        render json: serialize_prosecution_step(result.step), status: :created
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # GET /api/incidents/:id/notes
    def list_notes
      incident = scoped_record(Incident, params[:id])
      authorize incident, :list_notes?
      notes    = incident.incident_notes.includes(:author)
      notes    = notes.where("created_at <= ?", as_of) if as_of.present?
      render json: notes.map { |n| serialize_note(n) }
    end

    # POST /api/incidents/:id/notes
    # Body: { body: "..." }
    def add_note
      incident = scoped_record(Incident, params[:id])
      authorize incident, :add_note?
      result   = Incidents::NoteService.call(
        incident: incident,
        author:   current_user,
        body:     params[:body].to_s,
      )

      if result.success?
        render json: serialize_note(result.note), status: :created
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
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

    def serialize_incident(
      incident,
      detailed: false,
      replay_state: nil,
      alert_count: nil,
      task_count: nil,
      site_snapshot: nil,
      area_snapshot: nil,
      alerts: nil,
      tasks: nil
    )
      base = {
        id:               incident.id,
        title:            replay_state ? replay_state[:title] : incident.title,
        description:      replay_state ? replay_state[:description] : incident.description,
        status:           replay_state ? replay_state[:status] : incident.status,
        severity:         replay_state ? replay_state[:severity] : incident.severity,
        confidence:       replay_state ? replay_state[:confidence] : incident.confidence,
        opened_at:        incident.opened_at,
        acknowledged_at:  replay_state ? replay_state[:acknowledged_at] : incident.acknowledged_at,
        closed_at:        replay_state ? replay_state[:closed_at] : incident.closed_at,
        fusion_rationale: replay_state ? replay_state[:fusion_rationale] : incident.fusion_rationale,
        alert_count:      alert_count.nil? ? incident.signal_rule_matches.size : alert_count,
        task_count:       task_count.nil? ? incident.signal_rule_matches.filter_map(&:task_id).uniq.size : task_count,
        assigned_to:      replay_state ? replay_state[:assigned_to] : (incident.assigned_to ? {
          id:    incident.assigned_to.id,
          email: incident.assigned_to.email,
          role:  incident.assigned_to.role,
        } : nil),
        assigned_at:       replay_state ? replay_state[:assigned_at] : incident.assigned_at,
        site:              serialize_incident_site(incident, snapshot: site_snapshot),
        area_of_operation: serialize_incident_area(incident, snapshot: area_snapshot),
        # Prosecution fields — present on all responses, null when not prosecuted
        prosecution_phase:          replay_state ? replay_state[:prosecution_phase] : incident.prosecution_phase,
        prosecution_initiated_at:   replay_state ? replay_state[:prosecution_initiated_at] : incident.prosecution_initiated_at,
        prosecuted_by:              replay_state ? replay_state[:prosecuted_by] : (incident.prosecuted_by ? {
          id:    incident.prosecuted_by.id,
          email: incident.prosecuted_by.email,
        } : nil),
        created_at:  incident.created_at,
        updated_at:  incident.updated_at,
      }

      return base unless detailed

      base.merge(
        alerts: alerts || incident.signal_rule_matches.map { |m| serialize_alert(m) },
        tasks:  tasks || serialize_incident_tasks(incident)
      )
    end

    def serialize_replay_incidents(records, detailed:, as_of:)
      return [] if records.empty?

      replay_states = replay_states_for_incidents(records, as_of: as_of)
      matches_by_incident = records.each_with_object({}) do |record, grouped|
        grouped[record.id] = record.signal_rule_matches.select { |match| match.fired_at <= as_of }.sort_by(&:fired_at).reverse
      end
      replay_match_states = replay_states_for_matches(matches_by_incident.values.flatten, as_of: as_of)
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
          # The row stores the latest fused narrative, but the audit trail does
          # not yet carry historical snapshots of that text.
          fusion_rationale: nil,
        }

        future_events_by_incident.fetch(record.id, []).each do |event|
          snapshot = event.before_snapshot || {}

          %w[title description severity confidence status acknowledged_at closed_at assigned_to_id assigned_at prosecution_phase].each do |key|
            value = snapshot_value(snapshot, key)
            # A present key with nil means the historical value was explicitly
            # cleared; a missing key means this event did not touch that field.
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

    def replay_states_for_matches(matches, as_of:)
      ids = matches.map(&:id)
      latest_snapshots = latest_audit_snapshots(entity_type: "SignalRuleMatch", entity_ids: ids, as_of: as_of)
      acknowledged_by_ids = latest_snapshots.values.filter_map { |snapshot| snapshot_value(snapshot, "acknowledged_by_id") }.uniq
      emails_by_id = User.where(id: acknowledged_by_ids).pluck(:id, :email).to_h

      matches.each_with_object({}) do |match, states|
        snapshot = latest_snapshots[match.id] || {}
        acknowledged_by_id = snapshot_value(snapshot, "acknowledged_by_id")

        states[match.id] = {
          workflow_status: snapshot_value(snapshot, "workflow_status", fallback: "unacknowledged"),
          acknowledged_at: snapshot_value(snapshot, "acknowledged_at"),
          notes:           snapshot_value(snapshot, "notes"),
          acknowledged_by: acknowledged_by_id.present? ? {
            id: acknowledged_by_id,
            email: emails_by_id[acknowledged_by_id]
          }.compact : nil,
        }
      end
    end

    def load_replay_task_snapshots(task_ids, as_of:)
      latest_audit_snapshots(entity_type: "Task", entity_ids: task_ids, as_of: as_of)
    end

    def serialize_incident_tasks(incident)
      tasks_by_id = incident.tasks.index_by(&:id)
      ordered_task_ids = incident.signal_rule_matches.filter_map(&:task_id).uniq

      ordered_task_ids
        .filter_map { |task_id| tasks_by_id[task_id] }
        .map { |task| serialize_task(task) }
    end

    def serialize_alert(m, replay_state: nil, rule_snapshot: nil)
      {
        id:               m.id,
        fired_at:         m.fired_at,
        workflow_status:  replay_state ? replay_state[:workflow_status] : m.workflow_status,
        confidence:       m.confidence,
        geofence_breach:  m.metadata["geofence_breach"] == true,
        correlation_rule: serialize_alert_rule(m, snapshot: rule_snapshot),
        signal: m.signal ? {
          id: m.signal.id, signal_type: m.signal.signal_type,
          source: m.signal.source, lat: m.signal.lat, lng: m.signal.lng,
          occurred_at: m.signal.occurred_at
        } : nil,
      }
    end

    def serialize_task(t)
      {
        id:              t.id,
        title:           t.title,
        workflow_status: t.workflow_status,
        priority:        t.priority,
        asset_id:        t.asset_id,
      }
    end

    def serialize_task_snapshot(snapshot)
      {
        id:              snapshot_value(snapshot, "id"),
        title:           snapshot_value(snapshot, "title"),
        workflow_status: snapshot_value(snapshot, "workflow_status"),
        priority:        snapshot_value(snapshot, "priority"),
        asset_id:        snapshot_value(snapshot, "asset_id"),
      }
    end

    def serialize_incident_site(incident, snapshot: nil)
      return nil if incident.site_id.blank? && incident.site.blank? && snapshot.blank?

      {
        id: incident.site_id || incident.site&.id,
        name: snapshot_or_current(snapshot, "name", incident.site&.name),
      }
    end

    def serialize_incident_area(incident, snapshot: nil)
      return nil if incident.area_of_operation_id.blank? && incident.area_of_operation.blank? && snapshot.blank?

      {
        id: incident.area_of_operation_id || incident.area_of_operation&.id,
        name: snapshot_or_current(snapshot, "name", incident.area_of_operation&.name),
        posture: snapshot_or_current(snapshot, "posture", incident.area_of_operation&.posture),
      }
    end

    def serialize_alert_rule(match, snapshot: nil)
      return nil if match.correlation_rule_id.blank? && match.correlation_rule.blank? && snapshot.blank?

      {
        id: match.correlation_rule_id || match.correlation_rule&.id,
        name: snapshot_or_current(snapshot, "name", match.correlation_rule&.name),
      }
    end

    def serialize_note(note)
      {
        id:         note.id,
        body:       note.body,
        author:     { id: note.author.id, email: note.author.email },
        created_at: note.created_at,
      }
    end

    def serialize_prosecution_step(step)
      {
        id:            step.id,
        incident_id:   step.incident_id,
        actor:         { id: step.actor.id, email: step.actor.email },
        phase:         step.phase,
        action_type:   step.action_type,
        notes:         step.notes,
        evidence_refs: step.evidence_refs,
        occurred_at:   step.occurred_at,
        created_at:    step.created_at,
      }
    end

    # Permit and sanitise evidence_refs from the request.
    # Accepts { signal_ids: [], match_ids: [], task_ids: [], recommendation_ids: [] }.
    # Unknown keys are dropped by permit() — they never reach the JSONB column.
    def prosecution_step_evidence_refs
      raw = params[:evidence_refs]
      return {} unless raw.is_a?(ActionController::Parameters)

      raw.permit(signal_ids: [], match_ids: [], task_ids: [], recommendation_ids: [])
         .to_h
         .transform_values { |v| Array(v).map(&:to_s).reject(&:empty?) }
    end
  end
end
