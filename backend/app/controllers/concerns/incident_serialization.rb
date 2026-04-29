# Shared serialization helpers used by IncidentsController and its
# sub-controllers (prosecution, notes). Extracted to keep each controller
# focused on its own domain actions.
module IncidentSerialization
  extend ActiveSupport::Concern

  private

  def serialize_incident(
    incident,
    detailed: false,
    replay_state: nil,
    as_of: nil,
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
      prosecution_phase:          replay_state ? replay_state[:prosecution_phase] : incident.prosecution_phase,
      prosecution_initiated_at:   replay_state ? replay_state[:prosecution_initiated_at] : incident.prosecution_initiated_at,
      prosecuted_by:              replay_state ? replay_state[:prosecuted_by] : (incident.prosecuted_by ? {
        id:    incident.prosecuted_by.id,
        email: incident.prosecuted_by.email,
      } : nil),
      created_at:  incident.created_at,
      # QA F3 (2026-04-28): clamp updated_at to as_of during replay so an
      # incident that was modified after the replay cutoff doesn't show a
      # future "last updated" timestamp. Matches the precedent already in
      # tasks_controller.rb#176 and correlation_rules_controller.rb#370.
      # Without this clamp, an operator scrubbing replay would see
      # `updated_at` move forward in time independent of as_of, giving the
      # false impression that the incident was just touched.
      updated_at:  as_of.present? ? [incident.updated_at, as_of].min : incident.updated_at,
    }

    return base unless detailed

    base.merge(
      alerts: alerts || incident.signal_rule_matches.map { |m| serialize_alert(m) },
      tasks:  tasks || serialize_incident_tasks(incident)
    )
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

  def serialize_alert(m, replay_state: nil, rule_snapshot: nil, task_snapshot: nil, task_visible: true, site_snapshot: nil)
    {
      id:               m.id,
      fired_at:         m.fired_at,
      workflow_status:  replay_state ? replay_state[:workflow_status] : m.workflow_status,
      acknowledged_at:  replay_state ? replay_state[:acknowledged_at] : m.acknowledged_at,
      acknowledged_by:  replay_state ? replay_state[:acknowledged_by] : (m.acknowledged_by ? {
        id: m.acknowledged_by.id,
        email: m.acknowledged_by.email,
      } : nil),
      notes:            replay_state ? replay_state[:notes] : m.notes,
      confidence:       m.confidence,
      metadata:         m.metadata,
      geofence_breach:  m.metadata["geofence_breach"] == true,
      correlation_rule: serialize_alert_rule(m, snapshot: rule_snapshot),
      site: serialize_alert_site(m, snapshot: site_snapshot),
      task: serialize_alert_task(m, snapshot: task_snapshot, visible: task_visible),
      signal: m.signal ? {
        id: m.signal.id, signal_type: m.signal.signal_type,
        source: m.signal.source, lat: m.signal.lat, lng: m.signal.lng,
        occurred_at: m.signal.occurred_at
      } : nil,
    }
  end

  def serialize_alert_rule(match, snapshot: nil)
    return nil if match.correlation_rule_id.blank? && match.correlation_rule.blank? && snapshot.blank?

    {
      id: match.correlation_rule_id || match.correlation_rule&.id,
      name: snapshot_or_current(snapshot, "name", match.correlation_rule&.name),
    }
  end

  def serialize_alert_site(match, snapshot: nil)
    return nil if match.site_id.blank? && match.site.blank? && snapshot.blank?

    {
      id: match.site_id || match.site&.id,
      name: snapshot_or_current(snapshot, "name", match.site&.name),
    }
  end

  def serialize_alert_task(match, snapshot: nil, visible: true)
    return nil unless visible
    if snapshot.present?
      return {
        id: snapshot_value(snapshot, "id"),
        title: snapshot_value(snapshot, "title"),
        workflow_status: snapshot_value(snapshot, "workflow_status"),
        priority: snapshot_value(snapshot, "priority"),
      }
    end
    return nil unless match.task

    {
      id: match.task.id,
      title: match.task.title,
      workflow_status: match.task.workflow_status,
      priority: match.task.priority,
    }
  end

  def serialize_incident_task(t)
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

  def serialize_incident_tasks(incident)
    tasks_by_id = incident.tasks.index_by(&:id)
    ordered_task_ids = incident.signal_rule_matches.filter_map(&:task_id).uniq

    ordered_task_ids
      .filter_map { |task_id| tasks_by_id[task_id] }
      .map { |task| serialize_incident_task(task) }
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
end
