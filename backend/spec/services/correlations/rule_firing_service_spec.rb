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
        event: "rule_fired",
        data:  hash_including(
          :rule_id, :rule_name, :site_id, :site_name,
          :task_id, :task_title, :priority,
          :signal_type, :source, :distance_km, :fired_at
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
      expect { result }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.order(:occurred_at).last
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

    it "produces near-zero confidence for a signal right at the proximity boundary" do
      # proximity_km = 100; place signal ~99 km away
      # 1 degree latitude ≈ 111 km → 0.89° ≈ 99 km
      boundary_signal = create(:external_signal,
                               lat: 52.39, lng: 0.0,
                               signal_type: "seismic_event",
                               source: "usgs_seismic")
      boundary_result = described_class.call(rule: rule, signal: boundary_signal, site: site)

      expect(boundary_result.payload[:match].confidence).to be < 0.05
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
end
