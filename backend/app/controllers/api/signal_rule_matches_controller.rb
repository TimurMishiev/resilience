module Api
  class SignalRuleMatchesController < BaseController
    # GET /api/signal_rule_matches
    # Query params: rule_id, site_id, from, to, page, per_page
    def index
      matches = SignalRuleMatch.order(fired_at: :desc)
                               .includes(:signal, :correlation_rule, :site, :task)

      matches = matches.for_rule(params[:rule_id]) if params[:rule_id].present?
      matches = matches.for_site(params[:site_id]) if params[:site_id].present?
      matches = matches.where("fired_at >= ?", safe_parse_datetime(params[:from])) if params[:from].present?
      matches = matches.where("fired_at <= ?", safe_parse_datetime(params[:to]))   if params[:to].present?

      records, meta = paginate(matches)
      render json: { data: records.map { |m| serialize_match(m) }, meta: meta }
    end

    # GET /api/signal_rule_matches/:id
    def show
      match = SignalRuleMatch.includes(:signal, :correlation_rule, :site, :task)
                             .find(params[:id])
      render json: serialize_match(match)
    end

    private

    def serialize_match(match)
      {
        id:                    match.id,
        fired_at:              match.fired_at,
        metadata:              match.metadata,
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
