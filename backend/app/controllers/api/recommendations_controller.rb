module Api
  class RecommendationsController < BaseController
    include IncidentSerialization

    before_action :require_commander!, only: %i[generate]
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: :index

    # GET /api/recommendations
    # Query params: status, tier, type, affected_entity_type, affected_entity_id, as_of
    # as_of: ISO8601 — returns recommendations that existed at that point in time
    #         (created_at <= as_of and not yet expired at as_of).
    def index
      authorize Recommendation
      recs = policy_scope(Recommendation).includes(:reviewer).recent

      recs = recs.by_tier(params[:tier])                                  if params[:tier].present?
      recs = recs.where(recommendation_type: params[:type])               if params[:type].present?
      recs = recs.where(affected_entity_type: params[:affected_entity_type]) if params[:affected_entity_type].present?
      recs = recs.where(affected_entity_id:   params[:affected_entity_id])   if params[:affected_entity_id].present?

      if as_of
        recs = recs.where("created_at <= ?", as_of)
        records, meta = paginate_transformed_relation(recs) do |batch|
          serialize_replay_recommendations(batch, as_of: as_of)
        end
        render json: { data: records, meta: meta }
      else
        recs = recs.where(status: params[:status]) if params[:status].present?
        recs = recs.active if params[:status].blank?

        records, meta = paginate(recs)
        context = build_evidence_context(records, as_of: nil)
        render json: { data: records.map { |r| serialize(r, evidence_context: context) }, meta: meta }
      end
    end

    # POST /api/recommendations/generate
    # Triggers an on-demand generation run (commander only)
    def generate
      authorize Recommendation, :generate?
      result = Recommendations::GeneratorService.call
      if result.success?
        render json: { created: result.created, invalid_count: result.invalid_count }, status: :ok
      else
        render json: { errors: result.errors }, status: :unprocessable_content
      end
    end

    # POST /api/recommendations/:id/accept
    # Row-level lock + re-check matches the #execute pattern (line 99). Two
    # commanders clicking Accept simultaneously would both have passed the
    # `pending?` check pre-fix and both would have written `accept!` audit
    # events with last-write-wins on `reviewed_by_id` and `review_reason`.
    # The lock serialises the read-check-write window so the second writer
    # observes status="accepted" and returns 422.
    def accept
      rec = scoped_record(Recommendation, params[:id])
      authorize rec, :accept?
      transition_with_lock(rec, :accept!)
    end

    # POST /api/recommendations/:id/reject
    def reject
      rec = scoped_record(Recommendation, params[:id])
      authorize rec, :reject?
      transition_with_lock(rec, :reject!)
    end

    # POST /api/recommendations/:id/defer
    def defer
      rec = scoped_record(Recommendation, params[:id])
      authorize rec, :defer?
      transition_with_lock(rec, :defer!)
    end

    # POST /api/recommendations/:id/execute
    # Accepts (if pending) and immediately executes the recommendation.
    # Uses a row-level lock (SELECT FOR UPDATE) to prevent concurrent double-execution:
    # the second request will find status='executed' after the first commits and fail.
    #
    # Atomicity: with_lock wraps the block in a savepoint-backed transaction.
    # If ExecutorService fails we raise ActiveRecord::Rollback so the accept!
    # write is rolled back and the recommendation stays in its original status.
    def execute
      rec    = scoped_record(Recommendation, params[:id])
      authorize rec, :execute?
      result = nil

      rec.with_lock do
        unless rec.pending? || rec.accepted?
          render json: { errors: ["Recommendation is #{rec.status} — cannot execute"] }, status: :unprocessable_content
          return
        end

        rec.accept!(user: current_user, reason: "auto-accepted for execution") if rec.pending?

        result = Recommendations::ExecutorService.call(recommendation: rec, user: current_user)
        raise ActiveRecord::Rollback unless result.success?
      end

      if result&.success?
        fresh = rec.reload
        render json: serialize(fresh, evidence_context: build_evidence_context([fresh], as_of: nil))
      else
        render json: { errors: result&.errors || ["Execution failed"] }, status: :unprocessable_content
      end
    end

    # GET /api/recommendations/metrics
    def metrics
      authorize Recommendation, :metrics?
      # Single grouped query replaces 7 individual per-status counts.
      scoped_recommendations = policy_scope(Recommendation)
      by_status  = scoped_recommendations.group(:status).count
      by_tier    = scoped_recommendations.group(:tier).count

      accepted = by_status["accepted"].to_i
      rejected = by_status["rejected"].to_i
      deferred = by_status["deferred"].to_i
      executed = by_status["executed"].to_i
      expired  = by_status["expired"].to_i
      # active = pending + not yet expired; requires the scope's WHERE clause
      pending  = scoped_recommendations.active.count

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
        by_type: scoped_recommendations.group(:recommendation_type).count,
      }
    end

    private

    # Wraps a status transition (accept!/reject!/defer!) in a row-level lock
    # and re-checks `pending?` inside the lock so concurrent operators are
    # serialised. The second writer observes status="accepted" (or rejected/
    # deferred) and gets a 422 with the actual current state, matching the
    # contention contract that #execute already provides at line 99.
    def transition_with_lock(rec, action)
      already = nil

      rec.with_lock do
        unless rec.pending?
          already = rec.status
          next
        end
        rec.public_send(action, user: current_user, reason: params[:reason])
      end

      if already
        render json: { errors: ["Recommendation is already #{already}"] }, status: :unprocessable_content
      else
        render json: serialize(rec, evidence_context: build_evidence_context([rec], as_of: nil))
      end
    end

    def serialize(rec, replay_state: nil, evidence_context: nil)
      {
        id:                    rec.id,
        recommendation_type:   rec.recommendation_type,
        tier:                  rec.tier,
        status:                replay_state ? replay_state[:status] : rec.status,
        confidence:            rec.confidence,
        rationale:             rec.rationale,
        evidence:              resolve_evidence(rec.evidence, context: evidence_context),
        action_payload:        rec.action_payload,
        affected_entity_type:  rec.affected_entity_type,
        affected_entity_id:    rec.affected_entity_id,
        expires_at:            rec.expires_at,
        reviewed_by:           replay_state ? replay_state[:reviewed_by] : (rec.reviewer ? { id: rec.reviewer.id, email: rec.reviewer.email } : nil),
        reviewed_at:           replay_state ? replay_state[:reviewed_at] : rec.reviewed_at,
        review_reason:         replay_state ? replay_state[:review_reason] : rec.review_reason,
        executed_at:           replay_state ? replay_state[:executed_at] : rec.executed_at,
        created_at:            rec.created_at,
      }
    end

    def serialize_replay_recommendations(records, as_of:)
      replay_states = Replay::StateSerializer.recommendation_states(records, as_of: as_of)
      context = build_evidence_context(records, as_of: as_of)
      serialized = records.map do |record|
        serialize(record, replay_state: replay_states.fetch(record.id), evidence_context: context)
      end

      return serialized unless params[:status].present?

      serialized.select { |record| record[:status] == params[:status] }
    end

    # Builds a resolution context for evidence items across a batch of
    # recommendations. Resolves entity labels (site/incident/task/asset name/title)
    # and embeds full alert payloads for type=alert items so the frontend can
    # drill through to the evidence chain without a follow-up fetch.
    #
    # Replay-aware: when as_of is provided, labels come from audit snapshots
    # (falling back to current state if no snapshot exists), and alert payloads
    # use match/rule/task/site snapshots. Alerts with no snapshot at as_of are
    # returned as nil so the UI does not drill through to state that did not
    # exist at the replay point.
    def build_evidence_context(recs, as_of:)
      ids_by_type = Hash.new { |h, k| h[k] = [] }
      Array(recs).each do |rec|
        next unless rec.evidence.is_a?(Array)
        rec.evidence.each do |item|
          type = (item["type"] || item[:type]).to_s
          id   = item["id"]   || item[:id]
          next if type.blank? || id.blank?
          ids_by_type[type] << id
        end
      end
      ids_by_type.each_value(&:uniq!)

      # Load alert matches once; labels and payloads share the same collection.
      # In replay, matches whose fired_at > as_of are filtered out uniformly so
      # a post-as-of match produces neither a label nor a drill-through payload.
      alert_matches = load_alert_matches(ids_by_type["alert"])
      visible_alert_matches =
        if as_of
          alert_matches.select { |m| m.fired_at.present? && m.fired_at <= as_of }
        else
          alert_matches
        end

      {
        labels: {
          "site"     => resolve_labels(Site, "Site", "name", ids_by_type["site"], as_of: as_of),
          "incident" => resolve_labels(Incident, "Incident", "title", ids_by_type["incident"], as_of: as_of),
          "task"     => resolve_labels(Task, "Task", "title", ids_by_type["task"], as_of: as_of),
          "asset"    => resolve_labels(Asset, "Asset", "name", ids_by_type["asset"], as_of: as_of),
          "alert"    => resolve_alert_labels(visible_alert_matches, as_of: as_of),
        },
        alerts: resolve_alert_payloads(visible_alert_matches, as_of: as_of),
      }
    end

    def load_alert_matches(ids)
      return [] if ids.blank?
      policy_scope(SignalRuleMatch)
        .includes(:correlation_rule, :signal, :task, :site, :acknowledged_by)
        .where(id: ids)
        .to_a
    end

    def resolve_labels(model, entity_type, field, ids, as_of:)
      return {} if ids.blank?
      records   = policy_scope(model).where(id: ids).index_by(&:id)
      snapshots = as_of ? latest_audit_snapshots(entity_type: entity_type, entity_ids: ids, as_of: as_of) : {}

      ids.each_with_object({}) do |id, out|
        record   = records[id]
        snapshot = snapshots[id]
        next if record.nil? && snapshot.blank?
        out[id] = snapshot_or_current(snapshot, field, record&.public_send(field))
      end
    end

    def resolve_alert_labels(matches, as_of:)
      return {} if matches.blank?

      if as_of
        rule_ids = matches.filter_map(&:correlation_rule_id).uniq
        rule_snapshots = latest_audit_snapshots(entity_type: "CorrelationRule", entity_ids: rule_ids, as_of: as_of)
        matches.each_with_object({}) do |match, out|
          rule_name = snapshot_or_current(rule_snapshots[match.correlation_rule_id], "name", match.correlation_rule&.name)
          out[match.id] = rule_name if rule_name.present?
        end
      else
        matches.each_with_object({}) do |match, out|
          out[match.id] = match.correlation_rule&.name if match.correlation_rule&.name.present?
        end
      end
    end

    def resolve_alert_payloads(matches, as_of:)
      return {} if matches.blank?

      if as_of
        replay_states = Replay::StateSerializer.match_states(matches, as_of: as_of)
        rule_snapshots = latest_audit_snapshots(
          entity_type: "CorrelationRule",
          entity_ids: matches.filter_map(&:correlation_rule_id).uniq,
          as_of: as_of,
        )
        task_snapshots = latest_audit_snapshots(
          entity_type: "Task",
          entity_ids: matches.filter_map(&:task_id).uniq,
          as_of: as_of,
        )
        site_snapshots = latest_audit_snapshots(
          entity_type: "Site",
          entity_ids: matches.filter_map(&:site_id).uniq,
          as_of: as_of,
        )

        matches.each_with_object({}) do |match, out|
          out[match.id] = serialize_alert(
            match,
            replay_state: replay_states[match.id],
            rule_snapshot: rule_snapshots[match.correlation_rule_id],
            task_snapshot: match.task_id.present? ? task_snapshots[match.task_id] : nil,
            task_visible:  match.task_id.blank? || task_snapshots.key?(match.task_id),
            site_snapshot: site_snapshots[match.site_id],
          )
        end
      else
        matches.each_with_object({}) { |m, out| out[m.id] = serialize_alert(m) }
      end
    end

    def resolve_evidence(evidence, context:)
      return evidence unless evidence.is_a?(Array)

      evidence.map do |item|
        type = (item["type"] || item[:type]).to_s
        id   = item["id"]   || item[:id]
        base = item.is_a?(Hash) ? item.dup : item

        if context && id.present?
          label = context.dig(:labels, type, id)
          base["label"] = label if base.is_a?(Hash)
          if type == "alert" && base.is_a?(Hash)
            base["alert"] = context.dig(:alerts, id)
          end
        end

        base
      end
    end

  end
end
