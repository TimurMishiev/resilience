module Api
  class AiController < BaseController
    # All four AI endpoints are POST-shaped reads (LLM analysis with a
    # natural-language body) — none mutate state. ontology_query and summary
    # legitimately take as_of to scope the historical context the LLM sees.
    # The base-controller replay-mutation guard treats POST+as_of as a
    # mutation attempt by default; opt out here because these endpoints are
    # part of the read surface despite their HTTP verb.
    skip_before_action :reject_replay_mutations!

    # Both AI endpoints are commander-only — they make real Anthropic API calls
    # and the per-IP rate limit alone is insufficient if operators share an IP.
    before_action :require_commander!
    before_action :authorize_ai_action!

    # GET /api/ai/filter?q=...&entity_type=tasks|signals
    # entity_type defaults to 'tasks' for backward compatibility.
    def filter
      service = params[:entity_type] == "signals" ? Ai::SignalFilterService : Ai::FilterService
      result  = service.call(query: params.require(:q), user: current_user)

      if result.success
        render json: { data: result.payload }
      else
        render_service_failure(result)
      end
    end

    # POST /api/ai/ontology_query
    # Body: { q: "show incidents, alerts, and tasks connected to Forward Site Alpha", as_of?: ISO8601 }
    def ontology_query
      result = Ai::OntologyQueryService.call(
        query: params.require(:q),
        as_of: parse_datetime_param!(params[:as_of], param_name: "as_of"),
        user: current_user,
      )

      if result.success
        render json: { data: result.payload }
      else
        render_service_failure(result)
      end
    end

    # POST /api/ai/export
    # Body: { summary_type:, summary:, citations:[], context_counts:{...}, site_name?: }
    # Returns: application/pdf attachment
    def export
      counts = params.require(:context_counts)
                     .permit(:audit_events, :signals, :rule_fires)
                     .to_h

      result = Briefings::ExportService.call(
        summary:        params.require(:summary),
        citations:      Array(params[:citations]),
        context_counts: counts,
        summary_type:   params.require(:summary_type),
        site_name:      params[:site_name]
      )

      if result.success
        filename = "briefing-#{Time.zone.now.strftime('%Y%m%d-%H%M')}.pdf"
        send_data result.payload[:pdf],
                  filename:    filename,
                  type:        "application/pdf",
                  disposition: "attachment"
      else
        render_service_failure(result)
      end
    end

    # POST /api/ai/summary
    # Body: { summary_type:, site_id:, from:, to: }
    #
    # Datetime params are fail-closed: malformed `from` or `to` returns
    # 400 via parse_datetime_param! → InvalidDatetimeParamError. Until
    # 2026-04-25 the controller used safe_parse_datetime which silently
    # returned nil on garbage input, causing the AI summary to run over
    # the wrong window without surfacing a contract break to the caller.
    # Mirrors signals_controller's fail-closed pattern + ontology_query.
    def summary
      result = Ai::SummaryService.call(
        summary_type: params.require(:summary_type),
        site_id:      params[:site_id],
        from:         parse_datetime_param!(params[:from], param_name: "from"),
        to:           parse_datetime_param!(params[:to],   param_name: "to"),
        user:         current_user,
      )

      if result.success
        render json: { data: result.payload }
      else
        render_service_failure(result)
      end
    end

    private

    def authorize_ai_action!
      authorize :ai, :"#{action_name}?"
    end
  end
end
