module Api
  class SignalRuleMatchesController < BaseController
    # GET /api/signal_rule_matches
    # Query params: rule_id, site_id, workflow_status, geofence_breach, from, to, page, per_page
    def index
      matches = SignalRuleMatch.order(fired_at: :desc)
                               .includes(:signal, :correlation_rule, :site, :task, :acknowledged_by)

      matches = matches.for_rule(params[:rule_id])        if params[:rule_id].present?
      matches = matches.for_site(params[:site_id])        if params[:site_id].present?
      matches = matches.by_status(params[:workflow_status]) if params[:workflow_status].present?
      matches = matches.where("fired_at >= ?", safe_parse_datetime(params[:from])) if params[:from].present?
      matches = matches.where("fired_at <= ?", safe_parse_datetime(params[:to]))   if params[:to].present?
      # geofence_breach=true → only geofence-triggered matches (metadata flag, not pagination-driven)
      if params[:geofence_breach].present?
        if ActiveModel::Type::Boolean.new.cast(params[:geofence_breach])
          matches = matches.where("(metadata->>'geofence_breach')::boolean = true")
        else
          matches = matches.where("(metadata->>'geofence_breach') IS DISTINCT FROM 'true'")
        end
      end

      records, meta = paginate(matches)
      render json: { data: records.map { |m| serialize_match(m) }, meta: meta }
    end

    # GET /api/signal_rule_matches/:id
    def show
      match = SignalRuleMatch.includes(:signal, :correlation_rule, :site, :task, :acknowledged_by)
                             .find(params[:id])
      render json: serialize_match(match)
    end

    # GET /api/signal_rule_matches/active_breach_sites
    # Returns all site IDs with at least one unacknowledged geofence breach.
    # Unpaginated by design — used by the map to render breach rings without
    # any risk of a page cap silently omitting an active breach site.
    def active_breach_sites
      site_ids = SignalRuleMatch
                   .where("(metadata->>'geofence_breach')::boolean = true")
                   .where(workflow_status: :unacknowledged)
                   .where.not(site_id: nil)
                   .distinct
                   .pluck(:site_id)
      render json: { site_ids: site_ids }
    end

    # POST /api/signal_rule_matches/bulk_transition
    # Body: { ids: [...], to_status: "acknowledged", notes: "..." }
    # Runs each alert through the same TransitionService used for single transitions.
    # Per-alert failures (invalid transition from current state) go to `failed`
    # without aborting the rest of the batch.  Hard cap: MAX_BULK IDs per call.
    MAX_BULK = 100

    def bulk_transition
      ids       = Array(params[:ids]).first(MAX_BULK)
      to_status = params[:to_status].to_s.strip
      notes     = params[:notes].presence

      if ids.blank? || to_status.blank?
        return render json: { errors: ["ids and to_status are required"] },
                      status: :unprocessable_content
      end

      succeeded = []
      failed    = []

      SignalRuleMatch.where(id: ids).each do |match|
        result = Alerts::TransitionService.call(
          match:     match,
          to_status: to_status,
          actor:     current_user,
          notes:     notes
        )

        if result.success
          succeeded << { id: match.id, workflow_status: match.reload.workflow_status }
        else
          failed << { id: match.id, errors: result.errors }
        end
      end

      render json: { succeeded: succeeded, failed: failed }
    end

    # POST /api/signal_rule_matches/:id/transition
    # Body: { transition: { to_status: "acknowledged", notes: "..." } }
    # Available to operators and commanders — alert triage is not command-restricted.
    def transition
      match  = SignalRuleMatch.find(params[:id])
      result = Alerts::TransitionService.call(
        match:     match,
        to_status: transition_params[:to_status],
        actor:     current_user,
        notes:     transition_params[:notes]
      )

      if result.success
        render json: serialize_match(result.payload[:match].reload)
      else
        render_service_failure(result)
      end
    end

    # GET /api/signal_rule_matches/:id/allowed_transitions
    def allowed_transitions
      match = SignalRuleMatch.find(params[:id])
      render json: { allowed: Alerts::TransitionService.allowed_transitions_for(match.workflow_status) }
    end

    private

    def transition_params
      params.require(:transition).permit(:to_status, :notes)
    end

    def serialize_match(match)
      {
        id:              match.id,
        fired_at:        match.fired_at,
        confidence:      match.confidence,
        workflow_status: match.workflow_status,
        acknowledged_at: match.acknowledged_at,
        notes:           match.notes,
        acknowledged_by: match.acknowledged_by ? {
          id:    match.acknowledged_by.id,
          email: match.acknowledged_by.email
        } : nil,
        metadata:        match.metadata,
        signal: match.signal ? {
          id:          match.signal.id,
          source:      match.signal.source,
          signal_type: match.signal.signal_type,
          lat:         match.signal.lat,
          lng:         match.signal.lng,
          occurred_at: match.signal.occurred_at
        } : nil,
        correlation_rule: match.correlation_rule ? {
          id:   match.correlation_rule.id,
          name: match.correlation_rule.name
        } : nil,
        site: match.site ? {
          id:   match.site.id,
          name: match.site.name
        } : nil,
        task: match.task ? {
          id:              match.task.id,
          title:           match.task.title,
          workflow_status: match.task.workflow_status,
          priority:        match.task.priority
        } : nil
      }
    end
  end
end
