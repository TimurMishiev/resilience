module Api
  class RecommendationsController < BaseController
    before_action :require_commander!, only: %i[generate accept reject defer execute]

    # GET /api/recommendations
    # Query params: status, tier, type, affected_entity_type, affected_entity_id
    def index
      recs = Recommendation.includes(:reviewer).recent

      recs = recs.where(status: params[:status])                          if params[:status].present?
      recs = recs.by_tier(params[:tier])                                  if params[:tier].present?
      recs = recs.where(recommendation_type: params[:type])               if params[:type].present?
      recs = recs.where(affected_entity_type: params[:affected_entity_type]) if params[:affected_entity_type].present?
      recs = recs.where(affected_entity_id:   params[:affected_entity_id])   if params[:affected_entity_id].present?

      # Default: only show active (pending + not expired)
      recs = recs.active if params[:status].blank?

      records, meta = paginate(recs)
      render json: { data: records.map { |r| serialize(r) }, meta: meta }
    end

    # POST /api/recommendations/generate
    # Triggers an on-demand generation run (commander only)
    def generate
      result = Recommendations::GeneratorService.call
      if result.success?
        render json: { created: result.created, invalid_count: result.invalid_count }, status: :ok
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # POST /api/recommendations/:id/accept
    def accept
      rec = find_pending_rec
      return if rec.nil?
      rec.accept!(user: current_user, reason: params[:reason])
      render json: serialize(rec)
    end

    # POST /api/recommendations/:id/reject
    def reject
      rec = find_pending_rec
      return if rec.nil?
      rec.reject!(user: current_user, reason: params[:reason])
      render json: serialize(rec)
    end

    # POST /api/recommendations/:id/defer
    def defer
      rec = find_pending_rec
      return if rec.nil?
      rec.defer!(user: current_user, reason: params[:reason])
      render json: serialize(rec)
    end

    # POST /api/recommendations/:id/execute
    # Accepts (if pending) and immediately executes the recommendation.
    # Uses a row-level lock (SELECT FOR UPDATE) to prevent concurrent double-execution:
    # the second request will find status='executed' after the first commits and fail.
    def execute
      rec = Recommendation.find(params[:id])

      rec.with_lock do
        unless rec.pending? || rec.accepted?
          render json: { errors: ["Recommendation is #{rec.status} — cannot execute"] }, status: :unprocessable_content
          return
        end

        rec.accept!(user: current_user, reason: "auto-accepted for execution") if rec.pending?

        result = Recommendations::ExecutorService.call(recommendation: rec, user: current_user)
        if result.success?
          render json: serialize(rec.reload)
        else
          render json: { errors: result.errors }, status: :unprocessable_content
        end
      end
    end

    # GET /api/recommendations/metrics
    def metrics
      # Single grouped query replaces 7 individual per-status counts.
      by_status  = Recommendation.group(:status).count
      by_tier    = Recommendation.group(:tier).count

      accepted = by_status["accepted"].to_i
      rejected = by_status["rejected"].to_i
      deferred = by_status["deferred"].to_i
      executed = by_status["executed"].to_i
      expired  = by_status["expired"].to_i
      # active = pending + not yet expired; requires the scope's WHERE clause
      pending  = Recommendation.active.count

      # `executed` recommendations were accepted-and-run in a single step, so
      # they count in both the numerator and denominator of accept_rate.
      # Otherwise a healthy execute-heavy workflow would show a declining rate.
      effectively_accepted = accepted + executed
      total_reviewed       = effectively_accepted + rejected + deferred
      accept_rate          = total_reviewed > 0 ? (effectively_accepted.to_f / total_reviewed * 100).round(1) : nil

      render json: {
        pending:     pending,
        accepted:    accepted,
        rejected:    rejected,
        deferred:    deferred,
        executed:    executed,
        expired:     expired,
        accept_rate: accept_rate,
        by_tier: {
          rule: by_tier["rule"].to_i,
          llm:  by_tier["llm"].to_i,
        },
        by_type: Recommendation.group(:recommendation_type).count,
      }
    end

    private

    def find_pending_rec
      rec = Recommendation.find(params[:id])
      unless rec.pending?
        render json: { errors: ["Recommendation is already #{rec.status}"] }, status: :unprocessable_content
        return nil
      end
      rec
    end

    def serialize(rec)
      {
        id:                    rec.id,
        recommendation_type:   rec.recommendation_type,
        tier:                  rec.tier,
        status:                rec.status,
        confidence:            rec.confidence,
        rationale:             rec.rationale,
        evidence:              rec.evidence,
        action_payload:        rec.action_payload,
        affected_entity_type:  rec.affected_entity_type,
        affected_entity_id:    rec.affected_entity_id,
        expires_at:            rec.expires_at,
        reviewed_by:           rec.reviewer ? { id: rec.reviewer.id, email: rec.reviewer.email } : nil,
        reviewed_at:           rec.reviewed_at,
        review_reason:         rec.review_reason,
        executed_at:           rec.executed_at,
        created_at:            rec.created_at,
      }
    end
  end
end
