module Api
  class AiController < BaseController
    # Both AI endpoints are commander-only — they make real Anthropic API calls
    # and the per-IP rate limit alone is insufficient if operators share an IP.
    before_action :require_commander!

    # GET /api/ai/filter?q=show+blocked+tasks+at+Site+Alpha
    def filter
      result = Ai::FilterService.call(query: params.require(:q))

      if result.success
        render json: { data: result.payload }
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

    def safe_parse_datetime(value)
      return nil if value.blank?
      Time.zone.parse(value.to_s)
    rescue ArgumentError, TypeError
      nil
    end
  end
end
