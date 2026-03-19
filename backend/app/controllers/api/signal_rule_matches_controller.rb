module Api
  class SignalRuleMatchesController < BaseController
    # GET /api/signal_rule_matches
    # Query params: rule_id, site_id, workflow_status, from, to, page, per_page
    def index
      matches = SignalRuleMatch.order(fired_at: :desc)
                               .includes(:signal, :correlation_rule, :site, :task, :acknowledged_by)

      matches = matches.for_rule(params[:rule_id])        if params[:rule_id].present?
      matches = matches.for_site(params[:site_id])        if params[:site_id].present?
      matches = matches.by_status(params[:workflow_status]) if params[:workflow_status].present?
      matches = matches.where("fired_at >= ?", safe_parse_datetime(params[:from])) if params[:from].present?
      matches = matches.where("fired_at <= ?", safe_parse_datetime(params[:to]))   if params[:to].present?

      records, meta = paginate(matches)
      render json: { data: records.map { |m| serialize_match(m) }, meta: meta }
    end

    # GET /api/signal_rule_matches/:id
    def show
      match = SignalRuleMatch.includes(:signal, :correlation_rule, :site, :task, :acknowledged_by)
                             .find(params[:id])
      render json: serialize_match(match)
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
