require "rails_helper"

RSpec.describe Correlations::RuleFiringService do
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
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
