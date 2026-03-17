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
end
