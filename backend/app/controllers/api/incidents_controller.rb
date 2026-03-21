module Api
  class IncidentsController < BaseController
    # GET /api/incidents
    # Query params: status, severity, site_id, page, per_page
    def index
      incidents = Incident
        .includes(:site, :area_of_operation)
        .by_severity
        .recent

      incidents = incidents.by_status(params[:status]) if params[:status].present?
      incidents = incidents.where(severity: params[:severity]) if params[:severity].present?
      incidents = incidents.for_site(params[:site_id]) if params[:site_id].present?

      records, meta = paginate(incidents)
      render json: { data: records.map { |i| serialize_incident(i) }, meta: meta }
    end

    # GET /api/incidents/:id
    def show
      incident = Incident
        .includes(:site, :area_of_operation,
                  signal_rule_matches: [:signal, :correlation_rule, :task])
        .find(params[:id])
      render json: serialize_incident(incident, detailed: true)
    end

    # PATCH /api/incidents/:id
    def update
      incident = Incident.find(params[:id])
      incident.update!(incident_params)
      render json: serialize_incident(incident)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
    end

    # POST /api/incidents/:id/transition
    # Body: { to_status: "acknowledged" }
    def transition
      incident  = Incident.find(params[:id])
      to_status = params[:to_status].to_s.strip

      unless incident.allowed_transitions.include?(to_status)
        render json: { errors: ["Cannot transition from '#{incident.status}' to '#{to_status}'"] },
               status: :unprocessable_entity
        return
      end

      now = Time.current
      incident.status         = to_status
      incident.acknowledged_at = now if to_status == "acknowledged" && incident.acknowledged_at.nil?
      incident.closed_at       = now if %w[resolved closed].include?(to_status) && incident.closed_at.nil?
      incident.closed_at       = nil if to_status == "open"
      incident.save!

      render json: serialize_incident(incident)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
    end

    # GET /api/incidents/:id/allowed_transitions
    def allowed_transitions
      incident = Incident.find(params[:id])
      render json: { allowed: incident.allowed_transitions }
    end

    private

    def incident_params
      params.require(:incident).permit(:title, :description, :severity)
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
        site:             incident.site ? { id: incident.site.id, name: incident.site.name } : nil,
        area_of_operation: incident.area_of_operation ? {
          id:   incident.area_of_operation.id,
          name: incident.area_of_operation.name
        } : nil,
        created_at:  incident.created_at,
        updated_at:  incident.updated_at,
      }

      return base unless detailed

      base.merge(
        alerts: incident.signal_rule_matches.map { |m| serialize_alert(m) },
        tasks:  incident.signal_rule_matches.filter_map(&:task).uniq.map { |t| serialize_task(t) }
      )
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
      }
    end
  end
end
