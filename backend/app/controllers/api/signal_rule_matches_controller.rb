module Api
  class SignalRuleMatchesController < BaseController
    after_action :verify_authorized
    after_action :verify_policy_scoped, only: %i[index active_breach_sites active_site_confidence]

    # Bounded batch size for replay reductions on active_breach_sites and
    # active_site_confidence. Each iteration of the find_in_batches loop
    # holds one batch of SignalRuleMatch rows + the audit_events for those
    # IDs (~500 matches × ~5 events avg = ~2,500 objects per batch peak),
    # well within Puma worker heap budget. Replaces the prior pattern of
    # `.to_a` on the full historical set, which scaled linearly with tenant
    # alert history (A.2 fix). Set high enough that seed/demo data never
    # paginates (4 records → 1 batch); set low enough that real-tenant
    # history (10k+ matches) iterates in a bounded loop instead of
    # materializing the full set in one allocation.
    REPLAY_BATCH_SIZE = 500

    # GET /api/signal_rule_matches
    # Query params: rule_id, site_id, signal_id, workflow_status, geofence_breach, from, to, as_of, page, per_page
    # as_of: ISO8601 timestamp — limits fired_at to matches that existed at that point in time
    def index
      authorize SignalRuleMatch
      from_time = parse_datetime_param!(params[:from], param_name: "from")
      to_time   = parse_datetime_param!(params[:to], param_name: "to")

      matches = policy_scope(SignalRuleMatch).order(fired_at: :desc)
                                             .includes(:signal, :correlation_rule, :site, :task, :acknowledged_by)

      matches = matches.for_rule(params[:rule_id])        if params[:rule_id].present?
      matches = matches.for_site(params[:site_id])        if params[:site_id].present?
      matches = matches.where(signal_id: params[:signal_id]) if params[:signal_id].present?
      matches = matches.by_status(params[:workflow_status]) if params[:workflow_status].present? && as_of.blank?
      matches = matches.where("fired_at >= ?", from_time) if from_time.present?
      upper   = [to_time, as_of].compact.min
      matches = matches.where("fired_at <= ?", upper)                              if upper.present?
      # geofence_breach=true → only geofence-triggered matches (metadata flag, not pagination-driven)
      if params[:geofence_breach].present?
        if ActiveModel::Type::Boolean.new.cast(params[:geofence_breach])
          matches = matches.where("(metadata->>'geofence_breach')::boolean = true")
        else
          matches = matches.where("(metadata->>'geofence_breach') IS DISTINCT FROM 'true'")
        end
      end

      if as_of
        records, meta = paginate_transformed_relation(matches) do |batch|
          serialized = serialize_replay_matches(batch, as_of: as_of)
          if params[:workflow_status].present?
            serialized.select { |match| match[:workflow_status] == params[:workflow_status] }
          else
            serialized
          end
        end
        render json: { data: records, meta: meta }
      else
        records, meta = paginate(matches)
        render json: { data: records.map { |m| serialize_match(m) }, meta: meta }
      end
    end

    # GET /api/signal_rule_matches/:id
    def show
      match = scoped_record(
        SignalRuleMatch,
        params[:id],
        includes: [:signal, :correlation_rule, :site, :task, :acknowledged_by]
      )
      authorize match

      if as_of
        return render json: { errors: ["Signal rule match not found"] }, status: :not_found if match.fired_at > as_of

        render json: serialize_replay_matches([match], as_of: as_of).first
      else
        render json: serialize_match(match)
      end
    end

    # GET /api/signal_rule_matches/active_breach_sites
    # Returns all site IDs with at least one unacknowledged geofence breach.
    # Unpaginated by design — used by the map to render breach rings without
    # any risk of a page cap silently omitting an active breach site.
    def active_breach_sites
      authorize SignalRuleMatch, :active_breach_sites?
      breach_matches = policy_scope(SignalRuleMatch)
                         .where("(metadata->>'geofence_breach')::boolean = true")
                         .where.not(site_id: nil)
      site_ids =
        if as_of
          # Bounded-memory replay reduction: A.2 fix. Replaces a prior
          # `.to_a + StateSerializer.match_states(full_set)` pattern that
          # held both N matches AND M audit events in Ruby simultaneously
          # (e.g. 10k matches × ~5 events each = ~50k objects on the
          # heap mid-request at production-tenant scale). With batching,
          # peak heap is bounded to one batch's matches + their audit
          # events, regardless of historical alert volume.
          # Order is by primary key (find_in_batches default); the prior
          # `fired_at: :desc` ordering was not load-bearing for this
          # endpoint (final output is `uniq`'d site IDs — order
          # invariant under set semantics).
          collected = []
          breach_matches
            .select(:id, :site_id, :fired_at)
            .where("fired_at <= ?", as_of)
            .find_in_batches(batch_size: REPLAY_BATCH_SIZE) do |batch|
              batch_states = Replay::StateSerializer.match_states(batch, as_of: as_of)
              batch.each do |match|
                collected << match.site_id if batch_states.fetch(match.id)[:workflow_status] == "unacknowledged"
              end
            end
          collected.uniq
        else
          breach_matches
            .where(workflow_status: :unacknowledged)
            .distinct
            .pluck(:site_id)
        end

      render json: { site_ids: site_ids }
    end

    # GET /api/signal_rule_matches/active_site_confidence
    # Returns one summary row per site that currently has at least one
    # active (non-closed) SignalRuleMatch, carrying the maximum confidence
    # among that site's active matches. Unpaginated by design — used by the
    # `/map` (and later `/globe`) confidence-halo layer, which cannot tolerate
    # page caps silently omitting active sites. Same completeness pattern as
    # `active_breach_sites`.
    #
    # Replay (`as_of` present): clip to fired_at <= as_of, run
    # Replay::StateSerializer.match_states to reconstruct workflow_status at
    # that moment, drop replay-closed rows, then reduce site_id -> max
    # confidence. Drops nil site_ids.
    def active_site_confidence
      authorize SignalRuleMatch, :active_site_confidence?

      base = policy_scope(SignalRuleMatch).where.not(site_id: nil)

      summaries =
        if as_of
          # Bounded-memory replay reduction: A.2 fix. Same shape as
          # active_breach_sites above — see that method's comment for
          # the full rationale. Per-site max(confidence) is associative
          # and commutative, so the cross-batch merge (`max(existing,
          # new)`) preserves identical end semantics to the prior
          # full-materialization reduction.
          per_site_max = {}
          base
            .select(:id, :site_id, :fired_at, :confidence)
            .where("fired_at <= ?", as_of)
            .find_in_batches(batch_size: REPLAY_BATCH_SIZE) do |batch|
              batch_states = Replay::StateSerializer.match_states(batch, as_of: as_of)
              batch.each do |match|
                next if batch_states.fetch(match.id)[:workflow_status] == "closed"

                confidence = match.confidence.to_f
                current = per_site_max[match.site_id]
                per_site_max[match.site_id] = confidence if current.nil? || confidence > current
              end
            end

          per_site_max.map { |site_id, confidence| { site_id: site_id, confidence: confidence } }
        else
          base
            .where.not(workflow_status: :closed)
            .group(:site_id)
            .maximum(:confidence)
            .map { |site_id, confidence| { site_id: site_id, confidence: confidence.to_f } }
        end

      render json: { summaries: summaries }
    end

    # POST /api/signal_rule_matches/bulk_transition
    # Body: { ids: [...], to_status: "acknowledged", notes: "..." }
    # Runs each alert through the same TransitionService used for single transitions.
    # Per-alert failures (invalid transition from current state) go to `failed`
    # without aborting the rest of the batch.  Hard cap: MAX_BULK IDs per call.
    MAX_BULK = 100

    def bulk_transition
      authorize SignalRuleMatch, :bulk_transition?
      ids       = Array(params[:ids]).first(MAX_BULK)
      to_status = params[:to_status].to_s.strip
      notes     = params[:notes].presence

      if ids.blank? || to_status.blank?
        return render json: { errors: ["ids and to_status are required"] },
                      status: :unprocessable_content
      end

      succeeded = []
      failed    = []

      # Alerts::TransitionService calls @match.update! in-place inside its
      # transaction, so `match.workflow_status` is already the new status on
      # success. A per-match `.reload` here would add a SELECT-by-PK per
      # alert (up to MAX_BULK extra queries) with no behavioural value.
      policy_scope(SignalRuleMatch).where(id: ids).each do |match|
        result = Alerts::TransitionService.call(
          match:     match,
          to_status: to_status,
          actor:     current_user,
          notes:     notes
        )

        if result.success
          succeeded << { id: match.id, workflow_status: match.workflow_status }
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
      match  = scoped_record(SignalRuleMatch, params[:id])
      authorize match, :transition?
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
      match = scoped_record(SignalRuleMatch, params[:id])
      authorize match, :allowed_transitions?
      render json: { allowed: Alerts::TransitionService.allowed_transitions_for(match.workflow_status) }
    end

    private

    def transition_params
      params.require(:transition).permit(:to_status, :notes)
    end

    def serialize_match(match, replay_state: nil, rule_snapshot: nil, site_snapshot: nil, task_snapshot: nil, task_visible: true)
      {
        id:              match.id,
        fired_at:        match.fired_at,
        confidence:      match.confidence,
        workflow_status: replay_state ? replay_state[:workflow_status] : match.workflow_status,
        acknowledged_at: replay_state ? replay_state[:acknowledged_at] : match.acknowledged_at,
        notes:           replay_state ? replay_state[:notes] : match.notes,
        acknowledged_by: replay_state ? replay_state[:acknowledged_by] : (match.acknowledged_by ? {
          id:    match.acknowledged_by.id,
          email: match.acknowledged_by.email
        } : nil),
        metadata:        match.metadata,
        signal: match.signal ? {
          id:          match.signal.id,
          source:      match.signal.source,
          signal_type: match.signal.signal_type,
          lat:         match.signal.lat,
          lng:         match.signal.lng,
          occurred_at: match.signal.occurred_at
        } : nil,
        correlation_rule: serialize_match_rule(match, snapshot: rule_snapshot),
        site: serialize_match_site(match, snapshot: site_snapshot),
        task: serialize_match_task(match, snapshot: task_snapshot, visible: task_visible)
      }
    end

    def serialize_replay_matches(records, as_of:)
      replay_states = Replay::StateSerializer.match_states(records, as_of: as_of)
      site_snapshots = latest_audit_snapshots(
        entity_type: "Site",
        entity_ids: records.filter_map(&:site_id).uniq,
        as_of: as_of
      )
      rule_snapshots = latest_audit_snapshots(
        entity_type: "CorrelationRule",
        entity_ids: records.filter_map(&:correlation_rule_id).uniq,
        as_of: as_of
      )
      task_snapshots = latest_audit_snapshots(
        entity_type: "Task",
        entity_ids: records.filter_map(&:task_id).uniq,
        as_of: as_of
      )

      records.map do |record|
        serialize_match(
          record,
          replay_state: replay_states.fetch(record.id),
          rule_snapshot: rule_snapshots[record.correlation_rule_id],
          site_snapshot: site_snapshots[record.site_id],
          task_snapshot: task_snapshots[record.task_id],
          task_visible: record.task_id.blank? || task_snapshots.key?(record.task_id)
        )
      end
    end

    def serialize_match_rule(match, snapshot: nil)
      return nil if match.correlation_rule_id.blank? && match.correlation_rule.blank? && snapshot.blank?

      {
        id: match.correlation_rule_id || match.correlation_rule&.id,
        name: snapshot_or_current(snapshot, "name", match.correlation_rule&.name),
      }
    end

    def serialize_match_site(match, snapshot: nil)
      return nil if match.site_id.blank? && match.site.blank? && snapshot.blank?

      {
        id: match.site_id || match.site&.id,
        name: snapshot_or_current(snapshot, "name", match.site&.name),
      }
    end

    def serialize_match_task(match, snapshot: nil, visible: true)
      return nil unless visible
      return nil if match.task_id.blank? && match.task.blank? && snapshot.blank?

      {
        id: match.task_id || match.task&.id || snapshot_value(snapshot, "id"),
        title: snapshot_or_current(snapshot, "title", match.task&.title),
        workflow_status: snapshot_or_current(snapshot, "workflow_status", match.task&.workflow_status),
        priority: snapshot_or_current(snapshot, "priority", match.task&.priority),
      }
    end
  end
end
