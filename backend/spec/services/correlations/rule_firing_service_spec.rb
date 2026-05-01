require "rails_helper"

RSpec.describe Correlations::RuleFiringService do
  let(:logger) { instance_double(ActiveSupport::Logger, info: nil, error: nil) }

  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Rails).to receive(:logger).and_return(logger)
  end

  let(:site)   { create(:site, name: "Site Alpha", latitude: 51.5, longitude: 0.0) }
  let(:signal) { create(:external_signal, lat: 51.5, lng: 0.1, signal_type: "seismic_event", source: "usgs_seismic") }
  let(:rule) do
    create(:correlation_rule,
           name:       "Seismic Alert",
           conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
           actions:    { "create_task" => { "title" => "Alert near {{site_name}}", "priority" => "high" } })
  end

  subject(:result) { described_class.call(rule: rule, signal: signal, site: site) }

  describe "successful firing" do
    it "returns a successful ServiceResult" do
      expect(result.success).to be true
    end

    it "creates a Task" do
      expect { result }.to change(Task, :count).by(1)
    end

    it "creates a SignalRuleMatch" do
      expect { result }.to change(SignalRuleMatch, :count).by(1)
    end

    it "returns the match and task in the payload" do
      expect(result.payload[:match]).to be_a(SignalRuleMatch)
      expect(result.payload[:task]).to be_a(Task)
    end

    it "sets the task's site to the target site" do
      expect(result.payload[:task].site_id).to eq(site.id)
    end

    it "sets the task priority from the rule action" do
      expect(result.payload[:task].priority).to eq("high")
    end

    it "sets the task workflow_status to new" do
      expect(result.payload[:task].workflow_status).to eq("new")
    end

    it "stores distance_km and signal metadata on the match" do
      match = result.payload[:match]
      expect(match.metadata["distance_km"]).to be_a(Numeric)
      expect(match.metadata["signal_type"]).to eq("seismic_event")
      expect(match.metadata["signal_source"]).to eq("usgs_seismic")
    end

    it "updates the rule's last_fired_at" do
      expect { result }.to change { rule.reload.last_fired_at }.from(nil)
    end

    it "broadcasts a rule_fired SSE event" do
      result
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        hash_including(event: "rule_fired", data: hash_including(rule_name: "Seismic Alert"))
      )
    end

    it "logs a structured fired outcome" do
      result

      expect(logger).to have_received(:info)
        .with(include(
          "[RuleFiringService]",
          "outcome=fired",
          "rule=#{rule.id}",
          "signal=#{signal.id}",
          "site=#{site.id}",
          "actions=create_task",
        ))
    end
  end

  describe "title interpolation" do
    it "replaces {{site_name}} in the task title" do
      expect(result.payload[:task].title).to include("Site Alpha")
    end

    it "replaces {{proximity_km}} in the task title" do
      rule_with_template = create(:correlation_rule,
        conditions: { "signal_type" => "seismic_event", "proximity_km" => 75 },
        actions:    { "create_task" => { "title" => "{{proximity_km}} km alert", "priority" => "normal" } })
      r = described_class.call(rule: rule_with_template, signal: signal, site: site)
      expect(r.payload[:task].title).to eq("75 km alert")
    end

    it "uses the default title when no action title is set" do
      bare_rule = create(:correlation_rule,
        actions: { "create_task" => {} })
      r = described_class.call(rule: bare_rule, signal: signal, site: site)
      expect(r.payload[:task].title).to include("Site Alpha")
    end
  end

  describe "SSE broadcast payload" do
    it "includes all expected fields" do
      result
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        hash_including(
          event: "rule_fired",
          data:  hash_including(
            :rule_id, :rule_name, :site_id, :site_name,
            :task_id, :task_title, :priority,
            :signal_type, :source, :distance_km, :fired_at
          )
        )
      )
    end
  end

  describe "when Tasks::CreationService fails" do
    before do
      allow(Tasks::CreationService).to receive(:call).and_return(
        ServiceResult.failure(errors: ["title is blank"])
      )
    end

    it "returns a failure result" do
      expect(result.success).to be false
    end

    it "does not create a SignalRuleMatch" do
      expect { result }.not_to change(SignalRuleMatch, :count)
    end

    it "does not update last_fired_at" do
      expect { result }.not_to change { rule.reload.last_fired_at }
    end

    it "logs a structured failed outcome" do
      result

      expect(logger).to have_received(:error)
        .with(include(
          "[RuleFiringService]",
          "outcome=failed",
          "rule=#{rule.id}",
          "signal=#{signal.id}",
          "site=#{site.id}",
          "error_message=\"title is blank\"",
        ))
    end
  end

  describe "when cooldown is already claimed" do
    before do
      described_class.call(rule: rule, signal: signal, site: site)
      logger.reset if logger.respond_to?(:reset)
    end

    it "returns cooldown failure and logs a structured cooldown outcome" do
      cooldown_result = described_class.call(rule: rule, signal: signal, site: site)

      expect(cooldown_result.success).to be(false)
      expect(cooldown_result.errors).to eq(["cooldown"])
      expect(logger).to have_received(:info)
        .with(include(
          "[RuleFiringService]",
          "outcome=cooldown_skipped",
          "rule=#{rule.id}",
          "signal=#{signal.id}",
          "site=#{site.id}",
        ))
    end
  end

  # Codex backlog #5 (2026-04-28): transient DB errors must propagate to
  # the caller (RuleFiringJob) so retry_on can retry the job. Previously
  # the service's bottom `rescue StandardError` caught Deadlocked /
  # PG::Error / lock timeouts and wrapped them in ServiceResult.failure;
  # the job then raised RuleFiringFailure (NOT in retry_on) and
  # SolidQueue gave up after one attempt. The fix re-raises
  # ActiveRecord::StatementInvalid and PG::Error specifically, so the
  # job-level retry_on sees the original exception class.
  describe "Codex #5 — transient DB errors propagate for job-level retry" do
    it "re-raises ActiveRecord::Deadlocked instead of wrapping in ServiceResult.failure" do
      allow(SignalRuleMatch).to receive(:create!).and_raise(
        ActiveRecord::Deadlocked.new("deadlock detected"),
      )

      expect {
        described_class.call(rule: rule, signal: signal, site: site)
      }.to raise_error(ActiveRecord::Deadlocked, /deadlock detected/)
    end

    it "re-raises PG::Error instead of wrapping in ServiceResult.failure" do
      allow(SignalRuleMatch).to receive(:create!).and_raise(
        PG::ConnectionBad.new("connection lost"),
      )

      expect {
        described_class.call(rule: rule, signal: signal, site: site)
      }.to raise_error(PG::Error)
    end

    it "still returns ServiceResult.failure for non-DB errors (preserves prior behavior)" do
      allow(SignalRuleMatch).to receive(:create!).and_raise(
        ArgumentError.new("malformed metadata"),
      )

      r = described_class.call(rule: rule, signal: signal, site: site)
      expect(r.success).to be(false)
      expect(r.errors.first).to include("malformed metadata")
    end
  end

  # ---------------------------------------------------------------------------
  # escalate_task action
  # ---------------------------------------------------------------------------
  describe "escalate_task action" do
    let(:escalate_rule) do
      create(:correlation_rule, :escalate_task,
             conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 })
    end

    context "when an open task exists at the site" do
      let!(:existing_task) { create(:task, site: site, priority: "normal") }

      subject(:result) { described_class.call(rule: escalate_rule, signal: signal, site: site) }

      it "returns success" do
        expect(result.success).to be true
      end

      it "does not create a new Task" do
        expect { result }.not_to change(Task, :count)
      end

      it "bumps the task priority one level" do
        result
        expect(existing_task.reload.priority).to eq("high")
      end

      it "respects min_priority floor" do
        # task is already 'normal'; min_priority is 'high' → should land at 'high'
        result
        expect(existing_task.reload.priority).to eq("high")
      end

      it "records actions_taken as escalate_task in the match metadata" do
        result
        expect(SignalRuleMatch.last.metadata["actions_taken"]).to include("escalate_task")
      end

      it "does not escalate beyond critical" do
        critical_task = create(:task, site: site, priority: "critical")
        r = described_class.call(rule: escalate_rule, signal: signal, site: site)
        expect(r.payload[:task].priority).to eq("critical")
        expect(critical_task.reload.priority).to eq("critical")
      end
    end

    context "when no open task exists at the site" do
      subject(:result) { described_class.call(rule: escalate_rule, signal: signal, site: site) }

      it "creates a new Task as fallback" do
        expect { result }.to change(Task, :count).by(1)
      end

      it "creates the task at min_priority or high" do
        expect(result.payload[:task].priority).to eq("high")
      end
    end
  end

  # ---------------------------------------------------------------------------
  # flag_site action
  # ---------------------------------------------------------------------------
  describe "flag_site action" do
    let(:flag_rule) do
      create(:correlation_rule, :flag_site,
             conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 })
    end

    subject(:result) { described_class.call(rule: flag_rule, signal: signal, site: site) }

    it "returns success" do
      expect(result.success).to be true
    end

    it "does not create a Task" do
      expect { result }.not_to change(Task, :count)
    end

    it "sets flagged_at on the site" do
      expect { result }.to change { site.reload.flagged_at }.from(nil)
    end

    it "sets flag_reason with the interpolated reason" do
      result
      expect(site.reload.flag_reason).to include("Site Alpha")
      expect(site.reload.flag_reason).to include("seismic_event")
    end

    it "writes a site_flagged audit event for the rule-driven flag" do
      expect {
        result
      }.to change { AuditEvent.where(event_type: "site_flagged").count }.by(1)

      event = AuditEvent.where(event_type: "site_flagged").order(:occurred_at).last
      expect(event.event_type).to eq("site_flagged")
      expect(event.actor).to eq("correlation_engine")
      expect(event.entity_type).to eq("Site")
      expect(event.entity_id).to eq(site.id)
      expect(event.before_snapshot["flagged_at"]).to be_nil
      expect(event.after_snapshot["flagged_at"]).to be_present
      expect(event.after_snapshot["flag_reason"]).to include("Site Alpha")
      expect(event.metadata).to include(
        "source" => "correlation_engine",
        "rule_id" => flag_rule.id,
        "rule_name" => flag_rule.name,
        "signal_id" => signal.id
      )
    end

    it "still creates a SignalRuleMatch" do
      expect { result }.to change(SignalRuleMatch, :count).by(1)
    end

    it "records actions_taken as flag_site in the match metadata" do
      result
      expect(SignalRuleMatch.last.metadata["actions_taken"]).to include("flag_site")
    end

    it "broadcasts rule_fired with actions_taken" do
      result
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        hash_including(event: "rule_fired",
                       data:  hash_including(actions_taken: include("flag_site")))
      )
    end
  end

  # ---------------------------------------------------------------------------
  # Confidence scoring
  # ---------------------------------------------------------------------------
  #
  # confidence is a 0.0–1.0 score stored on the SignalRuleMatch:
  #   proximity_score = 1 - (distance_km / proximity_km)
  #   AND rule → mean of per-condition scores
  #   OR  rule → max  of per-condition scores
  # ---------------------------------------------------------------------------
  describe "confidence scoring" do
    # site at (51.5, 0.0).  1 degree of longitude at 51.5° ≈ 69 km.
    # signal at (51.5, 0.1) → distance ≈ 6.9 km.
    # proximity_km = 100 → proximity_score = 1 - 6.9/100 ≈ 0.93

    it "stores a confidence float between 0 and 1 on the match" do
      expect(result.payload[:match].confidence).to be_between(0.0, 1.0)
    end

    it "produces higher confidence when the signal is closer to the site" do
      # Two separate rule instances so neither cooldown blocks the other.
      # signal A: ~6.9 km away (lng 0.1)  → lower proximity score
      # signal B: ~3.5 km away (lng 0.05) → higher proximity score
      far_rule = create(:correlation_rule,
                        conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
                        actions:    { "create_task" => { "priority" => "normal" } })
      close_rule = create(:correlation_rule,
                          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
                          actions:    { "create_task" => { "priority" => "normal" } })

      close_signal = create(:external_signal,
                            lat: 51.5, lng: 0.05,
                            signal_type: "seismic_event",
                            source: "usgs_seismic")

      far_result   = described_class.call(rule: far_rule,   signal: signal,       site: site)
      close_result = described_class.call(rule: close_rule, signal: close_signal, site: site)

      expect(close_result.payload[:match].confidence).to be > far_result.payload[:match].confidence
    end

    it "produces low confidence for a signal right at the proximity boundary (smooth-curve, not step)" do
      # proximity_km = 100; place signal ~99 km away (ratio ≈ 0.99).
      # Logistic falloff at this ratio → ~0.05 confidence. The previous
      # linear-with-hard-zero curve would have produced exactly 0.0 here
      # and 0.998 just inside; the smooth curve gives a continuous knee
      # near the boundary instead. Asserting < 0.10 keeps headroom for
      # the curve constants without being so loose the regression
      # surface is meaningless.
      boundary_signal = create(:external_signal,
                               lat: 52.39, lng: 0.0,
                               signal_type: "seismic_event",
                               source: "usgs_seismic")
      boundary_result = described_class.call(rule: rule, signal: boundary_signal, site: site)

      expect(boundary_result.payload[:match].confidence).to be < 0.10
    end

    it "applies a smooth falloff rather than a hard zero just past the proximity boundary" do
      # Two signals: one just inside the boundary (~99 km), one just
      # outside (~101 km). Old curve: 0.998 vs 0.000 — discontinuous.
      # New curve: ~0.05 vs ~0.04 — continuous knee.
      inside_signal  = create(:external_signal,
                              lat: 52.39, lng: 0.0,  # ~99 km
                              signal_type: "seismic_event", source: "usgs_seismic")
      outside_signal = create(:external_signal,
                              lat: 52.41, lng: 0.0,  # ~101 km
                              signal_type: "seismic_event", source: "usgs_seismic")

      inside_conf  = described_class.call(rule: rule, signal: inside_signal,  site: site).payload[:match]&.confidence || 0.0
      outside_conf = described_class.call(rule: rule, signal: outside_signal, site: site).payload[:match]&.confidence || 0.0

      # Confidences near the boundary should be close (smooth knee), not
      # a step from ~1.0 to 0.0.
      expect((inside_conf - outside_conf).abs).to be < 0.10
    end

    it "weights confidence by source reliability prior" do
      # USGS (reliability 1.00) should produce a higher confidence than
      # ACLED (reliability 0.70) for the same proximity and rule. Uses
      # two rules so the cooldown on one does not swallow the other's
      # firing — the cooldown race is tested separately.
      usgs_rule = create(:correlation_rule,
                         :no_cooldown,
                         conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
                         actions:    { "create_task" => { "priority" => "normal" } })
      acled_rule = create(:correlation_rule,
                          :no_cooldown,
                          conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
                          actions:    { "create_task" => { "priority" => "normal" } })

      usgs_signal  = create(:external_signal,
                            lat: 51.5, lng: 0.0,
                            signal_type: "seismic_event", source: "usgs_seismic")
      acled_signal = create(:external_signal,
                            lat: 51.5, lng: 0.0,
                            signal_type: "seismic_event", source: "acled")

      usgs_conf  = described_class.call(rule: usgs_rule,  signal: usgs_signal,  site: site).payload[:match].confidence
      acled_conf = described_class.call(rule: acled_rule, signal: acled_signal, site: site).payload[:match].confidence

      # ACLED's source prior is 0.70; USGS is 1.00. Same proximity ⇒
      # ACLED confidence should be ~70% of USGS.
      expect(acled_conf).to be < usgs_conf
      expect(acled_conf).to be_within(0.05).of(usgs_conf * 0.70)
    end

    it "produces confidence of 1.0 when there is no proximity constraint" do
      unconstrained_rule = create(:correlation_rule,
                                  conditions: { "signal_type" => "seismic_event" },
                                  actions: { "create_task" => { "priority" => "normal" } })
      r = described_class.call(rule: unconstrained_rule, signal: signal, site: site)
      expect(r.payload[:match].confidence).to eq(1.0)
    end

    it "returns 0.0 confidence instead of crashing for a malformed persisted nested compound" do
      malformed_rule = build(:correlation_rule,
        conditions: {
          "operator" => "OR",
          "conditions" => [
            { "operator" => "AND", "conditions" => [] },
            { "signal_type" => "seismic_event", "proximity_km" => 100 }
          ]
        },
        actions: { "create_task" => { "priority" => "normal" } })
      malformed_rule.save!(validate: false)

      r = described_class.call(rule: malformed_rule, signal: signal, site: site)

      expect(r.success).to be(true)
      expect(r.payload[:match].confidence).to eq(0.0)
    end

    it "includes confidence in the SSE broadcast payload" do
      result
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        hash_including(event: "rule_fired", data: hash_including(:confidence))
      )
    end

    context "compound AND rule" do
      # Both conditions: ais_gap (direct) + gps_jamming (corroboration, 30 min old)
      let(:ais_signal) do
        create(:external_signal,
               signal_type: "ais_gap",
               source:      "derived",
               lat:         51.5, lng: 0.05)  # ~3.5 km from site
      end

      let!(:compound_and_rule) do
        create(:correlation_rule,
               conditions: {
                 "operator"   => "AND",
                 "conditions" => [
                   { "signal_type" => "ais_gap",     "proximity_km" => 100 },
                   { "signal_type" => "gps_jamming", "proximity_km" => 50, "time_window_minutes" => 60 }
                 ]
               })
      end

      before do
        # Corroborating GPS jamming signal: very close and recent → high freshness
        create(:external_signal,
               signal_type: "gps_jamming",
               source:      "gpsjam",
               lat:         51.5, lng: 0.02,  # ~1.4 km from site
               occurred_at: 5.minutes.ago)
      end

      it "confidence is the mean of both sub-condition scores" do
        r = described_class.call(rule: compound_and_rule, signal: ais_signal, site: site)
        c = r.payload[:match].confidence
        # Both sub-conditions are strong → confidence should be well above 0.5
        expect(c).to be > 0.5
        expect(c).to be_between(0.0, 1.0)
      end
    end

    context "compound OR rule" do
      let(:ais_signal) do
        create(:external_signal,
               signal_type: "ais_gap",
               source:      "derived",
               lat:         51.5, lng: 0.1)  # 6.9 km from site
      end

      let!(:compound_or_rule) do
        create(:correlation_rule,
               conditions: {
                 "operator"   => "OR",
                 "conditions" => [
                   { "signal_type" => "ais_gap",     "proximity_km" => 100 },
                   { "signal_type" => "gps_jamming", "proximity_km" => 50 }
                 ]
               })
      end

      it "confidence is the max of the per-condition scores" do
        r = described_class.call(rule: compound_or_rule, signal: ais_signal, site: site)
        c = r.payload[:match].confidence
        # ais_gap condition scores ~0.93; gps_jamming corroboration has no signals → 0.0
        # OR max → 0.93
        expect(c).to be > 0.8
        expect(c).to be_between(0.0, 1.0)
      end
    end
  end

  # ---------------------------------------------------------------------------
  # combined actions
  # ---------------------------------------------------------------------------
  describe "combined create_task + flag_site" do
    let(:combo_rule) do
      create(:correlation_rule,
             conditions: { "signal_type" => "seismic_event", "proximity_km" => 100 },
             actions: {
               "create_task" => { "title" => "Alert", "priority" => "high" },
               "flag_site"   => { "reason" => "Combo trigger" }
             })
    end

    subject(:result) { described_class.call(rule: combo_rule, signal: signal, site: site) }

    it "creates a Task and flags the site" do
      expect { result }.to change(Task, :count).by(1)
      expect(site.reload.flagged_at).not_to be_nil
    end

    it "records both actions_taken in the match metadata" do
      result
      taken = SignalRuleMatch.last.metadata["actions_taken"]
      expect(taken).to include("create_task", "flag_site")
    end
  end

  # ── SSE broadcast resilience ───────────────────────────────────────────────

  describe "SSE broadcast resilience" do
    it "still succeeds and commits the DB write when the broadcaster raises" do
      allow(Sse::Broadcaster.instance).to receive(:publish).and_raise(StandardError, "Redis connection lost")

      result = described_class.call(rule: rule, signal: signal, site: site)

      expect(result.success).to be true
      expect(SignalRuleMatch.count).to eq(1)
    end
  end

  # ── Duplicate signal+rule deduplication ────────────────────────────────────

  describe "duplicate signal+rule deduplication" do
    it "returns duplicate failure when the same signal+rule match already exists" do
      # First firing succeeds
      first = described_class.call(rule: rule, signal: signal, site: site)
      expect(first.success).to be true

      # Create a second rule instance with 0 cooldown so cooldown doesn't block it
      rule.update_column(:cooldown_minutes, 0)

      second = described_class.call(rule: rule, signal: signal, site: site)
      expect(second.success).to be false
      expect(second.errors).to eq(["duplicate"])
    end

    it "does not create a second SignalRuleMatch row" do
      described_class.call(rule: rule, signal: signal, site: site)
      rule.update_column(:cooldown_minutes, 0)

      expect {
        described_class.call(rule: rule, signal: signal, site: site)
      }.not_to change(SignalRuleMatch, :count)
    end

    it "does not create a duplicate Task" do
      described_class.call(rule: rule, signal: signal, site: site)
      rule.update_column(:cooldown_minutes, 0)

      expect {
        described_class.call(rule: rule, signal: signal, site: site)
      }.not_to change(Task, :count)
    end
  end

  describe "incident fusion outbox" do
    # Regression for the silent-orphan failure mode: previously
    # FusionService.call ran synchronously inside RuleFiringService#call.
    # If it raised (transient DB failure, lock contention), the bottom
    # rescue StandardError block caught the exception and returned a
    # failure result — but the SignalRuleMatch had already been
    # committed in an earlier transaction. The match existed forever
    # without an Incident, with no automatic retry.
    #
    # Now: enqueue Incidents::FusionJob via SolidQueue. ActiveJob's
    # retry_on policy on the job handles transient failures, and a
    # persistent failure lands in the dead-letter table for manual
    # review. Either way, no silent orphan.
    include ActiveJob::TestHelper

    it "enqueues Incidents::FusionJob with the new match id on successful firing" do
      expect {
        described_class.call(rule: rule, signal: signal, site: site)
      }.to have_enqueued_job(Incidents::FusionJob).with(SignalRuleMatch.last&.id || an_instance_of(String))
    end

    it "no longer calls FusionService synchronously inside the firing service" do
      expect(Incidents::FusionService).not_to receive(:call)
      described_class.call(rule: rule, signal: signal, site: site)
    end

    it "still returns a successful ServiceResult when the FusionJob enqueue raises" do
      # The match has committed by the time enqueue runs. A failed
      # enqueue is logged + reported but must not roll back the match
      # or report failure to the caller — the alert fired, even if
      # downstream incident grouping needs operator attention.
      allow(Incidents::FusionJob).to receive(:perform_later).and_raise(StandardError, "queue down")

      result = described_class.call(rule: rule, signal: signal, site: site)

      expect(result.success).to be true
      expect(SignalRuleMatch.count).to eq(1)
    end
  end

  # ── Concurrent cooldown claim (two real threads racing) ────────────────────
  #
  # The cooldown contract claims that two simultaneous calls cannot both fire
  # a rule. The atomic primitive is the conditional UPDATE inside the
  # service's transaction:
  #
  #   UPDATE correlation_rules
  #      SET last_fired_at = now()
  #    WHERE id = ?
  #      AND (last_fired_at IS NULL OR last_fired_at <= cutoff)
  #
  # Postgres acquires a row-level lock on the matching row; a second
  # transaction's UPDATE blocks until the first commits, then re-evaluates
  # the WHERE clause and matches zero rows. The service raises
  # CooldownActive on a zero-row result and the transaction rolls back.
  #
  # Until now this was proved only with travel_to + sequential calls — which
  # exercises the WHERE-clause logic but not the lock-and-re-evaluate part
  # under genuine concurrency. The interview-grade ambush is exactly that
  # gap. This spec spawns two threads, blocks them at a CyclicBarrier(2)
  # (which guarantees both have arrived before either proceeds — a
  # CountDownLatch + sleep is probabilistic and can silently weaken under
  # CI scheduling jitter), and asserts (a) exactly one ServiceResult is
  # success, (b) exactly one SignalRuleMatch row exists, (c) only one
  # Task was created, (d) the loser sees the canonical "cooldown" error,
  # (e) last_fired_at landed inside the test's wall-clock window.
  #
  # Tagged db_concurrency: true so rails_helper.rb switches to truncation —
  # data created in the example must be visible from threads holding their
  # own DB connections (see hook in spec/rails_helper.rb).
  describe "concurrent cooldown claim", db_concurrency: true do
    # Build the rule + site + signal eagerly so the threads see committed
    # data. Each thread uses with_connection to check out its own
    # connection from the pool.
    let!(:concurrent_site) do
      create(:site, name: "Concurrency Site", latitude: 51.5, longitude: 0.0)
    end
    let!(:concurrent_signal) do
      create(:external_signal,
             lat: 51.5, lng: 0.1,
             signal_type: "seismic_event",
             source: "usgs_seismic")
    end
    let!(:concurrent_rule) do
      create(:correlation_rule,
             name:             "Concurrent Cooldown Rule",
             cooldown_minutes: 60,
             last_fired_at:    nil,
             conditions:       { "signal_type" => "seismic_event", "proximity_km" => 100 },
             actions:          { "create_task" => { "title" => "Concurrent alert", "priority" => "normal" } })
    end

    it "lets exactly one of two simultaneous calls win the cooldown lock" do
      barrier = Concurrent::CyclicBarrier.new(2)
      results = Concurrent::Array.new
      errors  = Concurrent::Array.new

      window_start = Time.current

      threads = 2.times.map do
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            # Both threads block here; release together when the second
            # thread arrives. This is a hard correctness guarantee — unlike
            # CountDownLatch + sleep, no scheduling jitter can cause one
            # thread to start while the other has not yet reached the
            # rendezvous point.
            barrier.wait
            results << described_class.call(
              rule:   concurrent_rule,
              signal: concurrent_signal,
              site:   concurrent_site,
            )
          rescue StandardError => e
            errors << e
          end
        end
      end

      # Bounded join: if either thread fails to reach the barrier (e.g.
      # pool checkout raises before the rescue inside the with_connection
      # block can catch it), the surviving thread would block at
      # barrier.wait forever and an unbounded join would hang the test
      # runner indefinitely. 30s is generous on any real CI runner and
      # short enough that a hang fails loudly rather than wedges the suite.
      threads.each do |t|
        t.join(30) || raise("thread did not complete within 30s — likely barrier deadlock from a pre-barrier failure")
      end
      window_end = Time.current

      expect(errors).to be_empty, "threads raised: #{errors.map { |e| "#{e.class}: #{e.message}" }.join('; ')}"
      expect(results.size).to eq(2)

      successes = results.count { |r| r.success }
      failures  = results.reject { |r| r.success }

      expect(successes).to eq(1), "expected exactly one winner, got #{successes} successes / #{failures.size} failures"
      expect(failures.size).to eq(1)
      expect(failures.first.errors).to eq(["cooldown"])

      # And the side-effects honour the single winner: one match, one task.
      expect(SignalRuleMatch.where(correlation_rule_id: concurrent_rule.id).count).to eq(1)
      expect(Task.where(site_id: concurrent_site.id).count).to eq(1)

      # last_fired_at must land inside the test's wall-clock window. A
      # weaker `be_present` assertion would survive a future EventWriter
      # refactor that swaps the time source for a wrong one (e.g. UTC vs
      # local, or an injected stub left in by mistake) and silently
      # corrupt the cooldown gate's WHERE-clause math.
      expect(concurrent_rule.reload.last_fired_at).to be_between(window_start, window_end)
    end
  end
end
