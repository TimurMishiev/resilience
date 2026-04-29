module Correlations
  # Executes all actions defined on a matched correlation rule against a specific site.
  # Supported action types (any combination may appear in rule.actions):
  #
  #   create_task   — creates a new Task at the site
  #   escalate_task — bumps priority of the most recent open task; creates one if none exists
  #   flag_site     — sets site.flagged_at and site.flag_reason
  #
  # Records a SignalRuleMatch, updates the rule's last_fired_at for cooldown tracking,
  # and broadcasts a rule_fired SSE event.
  class RuleFiringService < ApplicationService
    PRIORITY_ORDER = %w[low normal high critical].freeze

    def initialize(rule:, signal:, site:)
      @rule   = rule
      @signal = signal
      @site   = site
    end

    # Raised inside the transaction to abort when the cooldown slot is already claimed.
    CooldownActive = Class.new(StandardError)

    def call
      task          = nil
      actions_taken = []
      match         = nil

      # ── Atomic transaction: cooldown claim + all actions ─────────────────────
      # The cooldown UPDATE and all side-effects run in one transaction.
      # If any action fails the whole transaction rolls back, including the
      # last_fired_at write, so retries are not blocked by a consumed cooldown.
      # Only the first of N concurrent jobs to execute the UPDATE wins the lock;
      # the rest see rows_updated == 0 and raise CooldownActive (caught below).
      ActiveRecord::Base.transaction do
        cooldown_cutoff = @rule.cooldown_minutes.minutes.ago
        rows_updated = CorrelationRule
          .where(id: @rule.id)
          .where("last_fired_at IS NULL OR last_fired_at <= ?", cooldown_cutoff)
          .update_all(last_fired_at: Time.current)

        raise CooldownActive if rows_updated == 0

        if @rule.actions.key?("create_task")
          result = execute_create_task
          raise result.errors.first unless result.success
          task = result.payload[:task]
          actions_taken << "create_task"
        end

        if @rule.actions.key?("escalate_task")
          result = execute_escalate_task
          raise result.errors.first unless result.success
          task ||= result.payload[:task]
          actions_taken << "escalate_task"
        end

        if @rule.actions.key?("flag_site")
          result = execute_flag_site
          raise result.errors.first unless result.success
          actions_taken << "flag_site"
        end

        match = SignalRuleMatch.create!(
          signal:           @signal,
          correlation_rule: @rule,
          site:             @site,
          task_id:          task&.id,
          fired_at:         Time.current,
          confidence:       compute_confidence,
          metadata: {
            distance_km:   distance_to_site.round(2),
            signal_type:   @signal.signal_type,
            signal_source: @signal.source,
            actions_taken: actions_taken
          }
        )
      end

      # SSE broadcast is a non-transactional side-effect — runs after commit.
      begin
        Sse::Broadcaster.instance.publish(
          event: "rule_fired",
          organization_id: @site.organization_id,
          data: {
            rule_id:       @rule.id,
            rule_name:     @rule.name,
            site_id:       @site.id,
            site_name:     @site.name,
            task_id:       task&.id,
            task_title:    task&.title,
            priority:      task&.priority,
            signal_type:   @signal.signal_type,
            source:        @signal.source,
            distance_km:   distance_to_site.round(1),
            confidence:      match&.confidence,
            workflow_status: match&.workflow_status,
            fired_at:        Time.current.iso8601,
            actions_taken: actions_taken
          }
        )
      rescue StandardError => e
        Rails.logger.error "[RuleFiringService] SSE broadcast failed (non-fatal): #{e.class}: #{e.message}"
      end

      # Incident fusion enqueue — durable retry path.
      #
      # Previously FusionService.call ran here synchronously. If it raised
      # (transient DB lock, unrelated downstream failure), the bottom
      # rescue StandardError block below caught the exception, logged it,
      # and returned ServiceResult.failure. The SignalRuleMatch was
      # already committed in the transaction above — the match existed
      # but was never fused into an Incident, with no automatic retry.
      # Permanent silent orphan.
      #
      # Now: enqueue Incidents::FusionJob via SolidQueue. The job writes
      # to solid_queue_jobs and runs in a worker with its own retry_on
      # StandardError, polynomially_longer, attempts: 5. Transient
      # failures retry automatically; persistent failures land in
      # SolidQueue's dead-letter table for manual review.
      #
      # The perform_later call itself can fail (e.g. queue DB
      # unreachable) — that's a much narrower failure window than
      # FusionService's full execution path, but we still log loudly so
      # the orphan is diagnosable rather than silent.
      if match
        begin
          Incidents::FusionJob.perform_later(match.id)
        rescue StandardError => e
          Rails.logger.error("[RuleFiringService] FusionJob enqueue failed match=#{match.id} error=#{e.class}: #{e.message}")
          Observability.capture_exception(
            e,
            tags: { component: "fusion_enqueue", match_id: match.id },
            throttle_key: "fusion_enqueue:#{e.class}",
            throttle_seconds: 60,
          )
        end
      end

      log_outcome(
        :info,
        outcome: "fired",
        task: task,
        match: match,
        actions_taken: actions_taken,
      )

      ServiceResult.success(match: match, task: task, actions_taken: actions_taken)
    rescue CooldownActive
      log_outcome(:info, outcome: "cooldown_skipped")
      ServiceResult.failure(errors: ["cooldown"])
    rescue ActiveRecord::RecordNotUnique
      log_outcome(:info, outcome: "duplicate_skipped")
      ServiceResult.failure(errors: ["duplicate"])
    rescue ActiveRecord::StatementInvalid, PG::Error
      # Codex backlog #5 (2026-04-28): transient DB errors
      # (Deadlocked, lock timeout, connection blip) MUST propagate
      # so the RuleFiringJob's `retry_on ActiveRecord::StatementInvalid,
      # PG::Error` can see the original exception class. The previous
      # `rescue StandardError` below caught these too, wrapped them
      # in ServiceResult.failure, and the job then raised a
      # RuleFiringFailure (NOT in retry_on) — converting transient
      # deadlocks into permanent job failures with no automatic
      # retry. Job-level logging at rule_firing_job.rb's rescue
      # StandardError block still records the error class for
      # diagnosis; we don't double-log here.
      raise
    rescue StandardError => e
      log_outcome(
        :error,
        outcome: "failed",
        task: task,
        match: match,
        actions_taken: actions_taken,
        error: e,
      )
      Observability.capture_exception(e, tags: { component: "rule_firing" }, throttle_key: "rule_firing:error:#{e.class}", throttle_seconds: 300)
      ServiceResult.failure(errors: [e.message])
    end

    private

    # ---------------------------------------------------------------------------
    # Action handlers
    # ---------------------------------------------------------------------------

    def execute_create_task
      action = @rule.actions["create_task"]
      Tasks::CreationService.call(
        params: {
          site_id:     @site.id,
          title:       interpolate(action["title"].presence || "Correlation alert near #{@site.name}"),
          description: interpolate(action["description"].presence || "Rule '#{@rule.name}' fired on #{@signal.signal_type} signal from #{@signal.source}."),
          priority:    action["priority"].presence || "normal"
        },
        actor:    "correlation_engine",
        metadata: {
          source:    "correlation_engine",
          rule_id:   @rule.id,
          rule_name: @rule.name,
          signal_id: @signal.id
        }
      )
    end

    def execute_escalate_task
      action    = @rule.actions["escalate_task"]
      min_level = action["min_priority"].presence
      open_task = @site.tasks.where.not(workflow_status: %w[resolved]).order(created_at: :desc).first

      unless open_task
        # No open task — fall back to creating one
        return Tasks::CreationService.call(
          params: {
            site_id:  @site.id,
            title:    interpolate(action["title"].presence || "Escalation alert near #{@site.name}"),
            priority: min_level.presence || "high"
          },
          actor:    "correlation_engine",
          metadata: { source: "correlation_engine", rule_id: @rule.id, signal_id: @signal.id }
        )
      end

      new_priority = escalated_priority(open_task.priority, min_level)
      return ServiceResult.success(task: open_task) if new_priority == open_task.priority

      Tasks::UpdateService.call(
        task:       open_task,
        params:     { "priority" => new_priority },
        actor:      "correlation_engine",
        actor_role: "commander"
      )
    end

    def execute_flag_site
      action = @rule.actions["flag_site"]
      reason = interpolate(action["reason"].presence || "Rule '#{@rule.name}' flagged this site.")
      before = @site.as_json(only: %i[flagged_at flag_reason])

      ApplicationRecord.transaction do
        @site.update!(flagged_at: Time.current, flag_reason: reason)

        Audit::EventWriter.write(
          actor:           "correlation_engine",
          entity_type:     "Site",
          entity_id:       @site.id,
          event_type:      "site_flagged",
          action:          "flag",
          before_snapshot: before,
          after_snapshot:  @site.as_json(only: %i[flagged_at flag_reason]),
          metadata: {
            source:    "correlation_engine",
            rule_id:   @rule.id,
            rule_name: @rule.name,
            signal_id: @signal.id
          },
          correlation_id:  SecureRandom.uuid
        )
      end

      ServiceResult.success(site: @site)
    rescue ActiveRecord::RecordInvalid => e
      ServiceResult.failure(errors: e.record.errors.full_messages)
    end

    # ---------------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------------

    def escalated_priority(current, min_level)
      idx      = PRIORITY_ORDER.index(current) || 0
      next_idx = [idx + 1, PRIORITY_ORDER.length - 1].min
      if min_level
        min_idx = PRIORITY_ORDER.index(min_level) || 0
        PRIORITY_ORDER[[next_idx, min_idx].max]
      else
        PRIORITY_ORDER[next_idx]
      end
    end

    def interpolate(str)
      str
        .gsub("{{site_name}}",    @site.name.to_s.truncate(100))
        .gsub("{{proximity_km}}", @rule.conditions["proximity_km"].to_s)
        .gsub("{{count}}",        @rule.conditions["count_threshold"].to_s)
        .gsub("{{signal_type}}",  @signal.signal_type.to_s.truncate(50))
        .gsub("{{source}}",       @signal.source.to_s.truncate(50))
        .truncate(500)
    end

    def distance_to_site
      Correlations::EvaluatorService.haversine_km(
        @site.latitude.to_f,  @site.longitude.to_f,
        @signal.lat.to_f, @signal.lng.to_f
      )
    end

    # ── Confidence scoring ─────────────────────────────────────────────────────
    #
    # Produces a 0.0–1.0 score reflecting how strongly the rule matched.
    # See ADR-008 for the full design rationale.
    #
    # Three layers compose the score:
    #
    # 1. Per-condition raw score. Each sub-condition is scored
    #    independently and aggregated:
    #      AND rule → mean (weakest link matters)
    #      OR rule  → max  (best matching condition wins)
    #
    # 2. Smooth proximity falloff. Logistic decay around the proximity
    #    boundary instead of the previous linear-with-hard-zero curve —
    #    closes the "49.9km = 0.998 confidence, 50.1km = 0.0" cliff
    #    that produced unrealistic step behaviour at the edge.
    #
    # 3. Source-trust prior. Multiplies the raw score by a per-source
    #    reliability weight (USGS seismic = 1.00; ACLED = 0.70; etc.).
    #    A 0.85 raw score from USGS stays 0.85; from ACLED becomes
    #    0.60. Honest about which feeds we trust most.
    #
    # NOT in this version: feedback loop on confirmed/rejected matches.
    # That requires schema work (a confirmation_outcome table) and a
    # learning-rate decision; documented as future work in ADR-008.

    # Per-source reliability priors. Tuned from public literature on
    # each feed's data-quality posture (see ADR-008 section "Source
    # priors — calibration"). Default for unknown sources is 0.50 so a
    # newly-added feed cannot accidentally inherit a high prior just
    # by being added to the constants table.
    SOURCE_RELIABILITY = {
      "usgs_seismic"  => 1.00,  # authoritative; minimal noise
      "nasa_firms"    => 0.95,  # satellite-derived, small lag
      "derived"       => 0.95,  # internally computed (AIS gap, loiter, etc) — well-tested code path
      "opensky"       => 0.90,  # crowd ADS-B, occasionally spoofed
      "ais_hub"       => 0.85,  # AIS — spoofable, generally reliable
      "gdacs"         => 0.85,  # multi-agency disaster aggregator
      "gpsjam"        => 0.75,  # crowd GPS jamming, detection-rate-bound
      "acled"         => 0.70,  # human-curated, days-to-weeks lag
    }.freeze
    DEFAULT_SOURCE_RELIABILITY = 0.50

    # Logistic-falloff steepness for proximity_confidence. Chosen so
    # the curve passes through (ratio=0.5, conf=0.5) and gives ~0.95
    # at the site centre, ~0.05 at the proximity boundary. Smooth
    # tails outside avoid the previous step-function cliff.
    PROXIMITY_LOGISTIC_K = 6.0

    def compute_confidence
      return 0.0 unless @rule.supported_condition_shape?

      norm     = @rule.normalized_conditions
      operator = norm["operator"]
      conds    = norm["conditions"]
      return 0.0 unless conds.is_a?(Array) && conds.any?

      scores = conds.map { |cond| condition_confidence(cond) }
      return 0.0 if scores.empty?

      raw = operator == "OR" ? scores.max : scores.sum / scores.size.to_f
      return 0.0 unless raw.is_a?(Numeric) && raw.finite?

      # Apply per-source reliability prior. The signal that triggered
      # the firing is the one whose source we trust (or don't); the
      # rule's other corroborating conditions already passed their own
      # proximity/freshness gates, so we do not compound trust priors
      # across the AND/OR tree — that would punish well-corroborated
      # rules with one weak source unfairly.
      source_weight = SOURCE_RELIABILITY.fetch(@signal.source, DEFAULT_SOURCE_RELIABILITY)
      (raw * source_weight).clamp(0.0, 1.0).round(2)
    end

    def condition_confidence(cond)
      signal_type  = cond["signal_type"]
      proximity_km = cond["proximity_km"].to_f

      if signal_type.present? && signal_type != @signal.signal_type
        corroboration_confidence(cond)
      else
        proximity_confidence(proximity_km, distance_to_site)
      end
    end

    # Smooth logistic falloff around the proximity boundary.
    #
    # Old shape (linear, hard-zero past the boundary):
    #   ratio=0    → 1.000
    #   ratio=0.5  → 0.500
    #   ratio=1.0  → 0.000  ← discontinuous step
    #   ratio=1.01 → 0.000  ← same as 10x outside
    #
    # New shape (logistic decay, smooth tails):
    #   ratio=0    → 0.953
    #   ratio=0.5  → 0.500
    #   ratio=1.0  → 0.047  ← knee at the boundary, not a cliff
    #   ratio=2.0  → 0.000  ← genuine far-out tail decay
    #
    # The previous step-function produced operationally implausible
    # behaviour: a signal at 49.9km from a 50km-radius rule scored
    # 0.998; at 50.1km, 0.000. No real-world threat-distance model
    # has that kind of edge. The logistic curve is a calibrated
    # falloff that matches operator intuition near the boundary.
    def proximity_confidence(proximity_km, actual_km)
      return 1.0 if proximity_km.zero?

      ratio = actual_km / proximity_km
      1.0 / (1.0 + Math.exp(PROXIMITY_LOGISTIC_K * (ratio - 0.5)))
    end

    # Finds the best (most recent, closest) corroborating signal and combines
    # its proximity score with its freshness within the time window.
    def corroboration_confidence(cond)
      proximity_km   = cond["proximity_km"].to_f
      window_min     = cond["time_window_minutes"].to_i
      window_min     = 60 if window_min.zero?
      window_seconds = window_min * 60.0

      candidates = ExternalSignal.where(
        signal_type: cond["signal_type"],
        occurred_at: window_min.minutes.ago..Time.current
      )
      # Bounding-box pre-filter avoids loading the full signal window into memory.
      # Exact Haversine is applied below; this just narrows the DB result set.
      candidates = candidates.near_point(@site.latitude, @site.longitude, proximity_km) if proximity_km > 0

      # Exact Haversine is applied in Ruby; find_in_batches avoids materializing the
      # full result set. We track the most-recent qualifying signal across all batches.
      best = nil
      candidates
        .select(:id, :lat, :lng, :occurred_at)
        .find_in_batches(batch_size: Correlations::EvaluatorService::SIGNAL_CANDIDATE_BATCH_SIZE) do |batch|
          batch.each do |s|
            next unless proximity_km.zero? || Correlations::EvaluatorService.haversine_km(
              @site.latitude.to_f, @site.longitude.to_f,
              s.lat.to_f,          s.lng.to_f
            ) <= proximity_km
            best = s if best.nil? || s.occurred_at > best.occurred_at
          end
        end

      return 0.0 if best.nil?

      dist = Correlations::EvaluatorService.haversine_km(
        @site.latitude.to_f, @site.longitude.to_f,
        best.lat.to_f,        best.lng.to_f
      )

      prox_score = proximity_confidence(proximity_km, dist)
      age_seconds = (Time.current - best.occurred_at).to_f
      freshness   = (1.0 - age_seconds / window_seconds).clamp(0.0, 1.0)

      (prox_score + freshness) / 2.0
    end

    def log_outcome(level, outcome:, task: nil, match: nil, actions_taken: nil, error: nil)
      parts = [
        "[RuleFiringService]",
        "outcome=#{outcome}",
        "rule=#{@rule.id}",
        "signal=#{@signal.id}",
        "site=#{@site.id}",
      ]

      parts << "match=#{match.id}" if match&.id
      parts << "task=#{task.id}" if task&.id
      parts << "confidence=#{match.confidence}" if match&.confidence
      parts << "workflow_status=#{match.workflow_status}" if match&.workflow_status.present?
      parts << "actions=#{actions_taken.join(',')}" if actions_taken.present?
      parts << "error_class=#{error.class}" if error
      parts << "error_message=#{error.message.inspect}" if error

      Rails.logger.public_send(level, parts.join(" "))
    end
  end
end
