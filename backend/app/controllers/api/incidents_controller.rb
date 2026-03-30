module Api
  class IncidentsController < BaseController
    # GET /api/incidents
    # Query params: status, severity, site_id, assigned_to_id, page, per_page
    def index
      incidents = Incident
        .includes(:site, :area_of_operation, :signal_rule_matches, :assigned_to, :prosecuted_by)
        .by_severity
        .recent

      incidents = incidents.by_status(params[:status])           if params[:status].present?
      incidents = incidents.where(severity: params[:severity])   if params[:severity].present?
      incidents = incidents.for_site(params[:site_id])           if params[:site_id].present?
      incidents = incidents.where(assigned_to_id: params[:assigned_to_id]) if params[:assigned_to_id].present?

      records, meta = paginate(incidents)
      render json: { data: records.map { |i| serialize_incident(i) }, meta: meta }
    end

    # GET /api/incidents/:id
    def show
      incident = Incident
        .includes(:site, :area_of_operation, :assigned_to,
                  :tasks,
                  signal_rule_matches: [:signal, :correlation_rule])
        .find(params[:id])
      render json: serialize_incident(incident, detailed: true)
    end

    # PATCH /api/incidents/:id
    def update
      incident = Incident.find(params[:id])
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
      incident  = Incident.find(params[:id])
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
      incident = Incident.find(params[:id])
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
      incident = Incident.find(params[:id])
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
      incident = Incident.find(params[:id])
      matches  = incident.signal_rule_matches.includes(:signal, :correlation_rule, :task)

      nodes = []
      edges = []
      seen  = Set.new

      # Incident node (always present — anchor of the graph)
      nodes << {
        id:   incident.id,
        type: "incident",
        data: { label: incident.title, status: incident.status, severity: incident.severity }
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
              status:     match.workflow_status,
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
          unless seen.include?("task-#{match.task.id}")
            seen.add("task-#{match.task.id}")
            nodes << {
              id:   "task-#{match.task.id}",
              type: "task",
              data: {
                label:    match.task.title,
                status:   match.task.workflow_status,
                priority: match.task.priority
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
      require_commander!
      return if performed?
      incident = Incident.find(params[:id])
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
      incident = Incident.find(params[:id])
      steps    = ProsecutionStep.for_incident(incident.id).includes(:actor)
      render json: steps.map { |s| serialize_prosecution_step(s) }
    end

    # POST /api/incidents/:id/prosecution_steps
    # Body: { phase:, action_type:, notes:, evidence_refs: { signal_ids: [], ... } }
    def add_prosecution_step
      require_commander!
      return if performed?
      incident = Incident.find(params[:id])
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
      incident = Incident.find(params[:id])
      notes    = incident.incident_notes.includes(:author)
      render json: notes.map { |n| serialize_note(n) }
    end

    # POST /api/incidents/:id/notes
    # Body: { body: "..." }
    def add_note
      incident = Incident.find(params[:id])
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

    def serialize_incident(incident, detailed: false)
      base = {
        id:               incident.id,
        title:            incident.title,
        description:      incident.description,
        status:           incident.status,
        severity:         incident.severity,
        confidence:       incident.confidence,
        opened_at:        incident.opened_at,
        acknowledged_at:  incident.acknowledged_at,
        closed_at:        incident.closed_at,
        fusion_rationale: incident.fusion_rationale,
        alert_count:      incident.signal_rule_matches.size,
        task_count:       incident.signal_rule_matches.filter_map(&:task_id).uniq.size,
        assigned_to:      incident.assigned_to ? {
          id:    incident.assigned_to.id,
          email: incident.assigned_to.email,
          role:  incident.assigned_to.role,
        } : nil,
        assigned_at:       incident.assigned_at,
        site:              incident.site ? { id: incident.site.id, name: incident.site.name } : nil,
        area_of_operation: incident.area_of_operation ? {
          id:      incident.area_of_operation.id,
          name:    incident.area_of_operation.name,
          posture: incident.area_of_operation.posture
        } : nil,
        # Prosecution fields — present on all responses, null when not prosecuted
        prosecution_phase:          incident.prosecution_phase,
        prosecution_initiated_at:   incident.prosecution_initiated_at,
        prosecuted_by:              incident.prosecuted_by ? {
          id:    incident.prosecuted_by.id,
          email: incident.prosecuted_by.email,
        } : nil,
        created_at:  incident.created_at,
        updated_at:  incident.updated_at,
      }

      return base unless detailed

      base.merge(
        alerts: incident.signal_rule_matches.map { |m| serialize_alert(m) },
        tasks:  serialize_incident_tasks(incident)
      )
    end

    def serialize_incident_tasks(incident)
      tasks_by_id = incident.tasks.index_by(&:id)
      ordered_task_ids = incident.signal_rule_matches.filter_map(&:task_id).uniq

      ordered_task_ids
        .filter_map { |task_id| tasks_by_id[task_id] }
        .map { |task| serialize_task(task) }
    end

    def serialize_alert(m)
      {
        id:               m.id,
        fired_at:         m.fired_at,
        workflow_status:  m.workflow_status,
        confidence:       m.confidence,
        geofence_breach:  m.metadata["geofence_breach"] == true,
        correlation_rule: m.correlation_rule ? {
          id: m.correlation_rule.id, name: m.correlation_rule.name
        } : nil,
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
    # Unknown keys are dropped to prevent polluting the JSONB column.
    def prosecution_step_evidence_refs
      raw = params[:evidence_refs]
      return {} unless raw.is_a?(ActionController::Parameters) || raw.is_a?(Hash)

      allowed_keys = %w[signal_ids match_ids task_ids recommendation_ids]
      raw.to_unsafe_h.slice(*allowed_keys).transform_values do |v|
        Array(v).map(&:to_s).reject(&:empty?)
      end
    end
  end
end
