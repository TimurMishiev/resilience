require "rails_helper"

RSpec.describe Rules::EffectivenessService, type: :service do
  let(:site) { create(:site) }
  # Use let! so the rule exists in the DB before any EffectivenessService.call runs.
  let!(:rule) { create(:correlation_rule) }

  describe "#call" do
    context "rule with no fires" do
      it "returns zero total_fires and nil rates" do
        row = stats_for(rule)

        expect(row).not_to be_nil
        expect(row[:total_fires]).to eq(0)
        expect(row[:fires_last_30d]).to eq(0)
        expect(row[:fires_last_7d]).to eq(0)
        expect(row[:avg_confidence]).to be_nil
        expect(row[:task_creation_rate]).to be_nil
        expect(row[:alert_closure_rate]).to be_nil
        expect(row[:low_value_flag]).to be false
      end
    end

    context "rule with fires but no tasks" do
      before do
        3.times do
          create(:signal_rule_match, :without_task,
            correlation_rule: rule,
            site:             site,
            confidence:       0.6,
            workflow_status:  "unacknowledged")
        end
      end

      it "returns correct total_fires" do
        expect(stats_for(rule)[:total_fires]).to eq(3)
      end

      it "returns avg_confidence" do
        expect(stats_for(rule)[:avg_confidence]).to be_within(0.01).of(0.6)
      end

      it "returns 0.0 task_creation_rate" do
        expect(stats_for(rule)[:task_creation_rate]).to eq(0.0)
      end

      it "returns 0.0 alert_closure_rate" do
        expect(stats_for(rule)[:alert_closure_rate]).to eq(0.0)
      end

      it "does not flag as low_value when fires < LOW_VALUE_MIN_FIRES (threshold = 5)" do
        expect(stats_for(rule)[:low_value_flag]).to be false
      end
    end

    context "low-value detection: >= 5 fires with no tasks and no closures" do
      before do
        5.times do
          create(:signal_rule_match, :without_task,
            correlation_rule: rule,
            site:             site,
            confidence:       0.3,
            workflow_status:  "unacknowledged")
        end
      end

      it "flags the rule as low_value" do
        expect(stats_for(rule)[:low_value_flag]).to be true
      end
    end

    context "rule with tasks and closed alerts" do
      let!(:resolved_task) do
        create(:task, site: site, workflow_status: "resolved", resolved_at: Time.current)
      end

      before do
        # 2 of 3 fires created a task → task_creation_rate = 2/3 ≈ 0.67
        create(:signal_rule_match, correlation_rule: rule, site: site,
               confidence: 0.8, workflow_status: "closed",       task: resolved_task)
        create(:signal_rule_match, correlation_rule: rule, site: site,
               confidence: 0.9, workflow_status: "closed",       task: resolved_task)
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               confidence: 0.5, workflow_status: "acknowledged")
      end

      it "returns correct task_creation_rate" do
        expect(stats_for(rule)[:task_creation_rate]).to be_within(0.01).of(0.67)
      end

      it "returns correct alert_closure_rate" do
        expect(stats_for(rule)[:alert_closure_rate]).to be_within(0.01).of(0.67)
      end

      it "returns 1.0 task_resolution_rate (all linked tasks are resolved)" do
        expect(stats_for(rule)[:task_resolution_rate]).to eq(1.0)
      end

      it "does not flag as low_value when closure rate is healthy" do
        expect(stats_for(rule)[:low_value_flag]).to be false
      end
    end

    context "fires_last_30d / fires_last_7d windowing" do
      before do
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               fired_at: 40.days.ago)   # outside both windows
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               fired_at: 15.days.ago)   # in 30d, outside 7d
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               fired_at: 3.days.ago)    # inside both windows
      end

      it "counts fires within 30d for fires_last_30d" do
        expect(stats_for(rule)[:fires_last_30d]).to eq(2)
      end

      it "counts fires within 7d for fires_last_7d" do
        expect(stats_for(rule)[:fires_last_7d]).to eq(1)
      end

      it "includes all fires in total_fires" do
        expect(stats_for(rule)[:total_fires]).to eq(3)
      end
    end

    context "avg_hours_to_ack calculation" do
      before do
        fired = 5.hours.ago
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               fired_at:         fired,
               acknowledged_at:  fired + 2.hours,
               workflow_status:  "acknowledged")
        # Unacknowledged match — must not affect the average
        create(:signal_rule_match, :without_task, correlation_rule: rule, site: site,
               fired_at:        1.hour.ago,
               acknowledged_at: nil,
               workflow_status: "unacknowledged")
      end

      it "computes avg_hours_to_ack only from acknowledged matches" do
        expect(stats_for(rule)[:avg_hours_to_ack]).to be_within(0.2).of(2.0)
      end
    end
  end

  private

  def stats_for(rule)
    described_class.call.payload[:stats].find { |s| s[:rule_id] == rule.id }
  end
end
