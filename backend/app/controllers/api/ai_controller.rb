module Api
  class AiController < BaseController
    # Both AI endpoints are commander-only — they make real Anthropic API calls
    # and the per-IP rate limit alone is insufficient if operators share an IP.
    before_action :require_commander!
    before_action :authorize_ai_action!

    # GET /api/ai/filter?q=...&entity_type=tasks|signals
    # entity_type defaults to 'tasks' for backward compatibility.
    def filter
      service = params[:entity_type] == "signals" ? Ai::SignalFilterService : Ai::FilterService
      result  = service.call(query: params.require(:q))

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
        as_of: safe_parse_datetime(params[:as_of]),
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
    def summary
      result = Ai::SummaryService.call(
        summary_type: params.require(:summary_type),
        site_id:      params[:site_id],
        from:         safe_parse_datetime(params[:from]),
        to:           safe_parse_datetime(params[:to])
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

    def safe_parse_datetime(value)
      return nil if value.blank?
      Time.zone.parse(value.to_s)
    rescue ArgumentError, TypeError
      nil
    end
  end
end
