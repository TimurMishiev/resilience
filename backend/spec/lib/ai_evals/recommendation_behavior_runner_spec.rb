require "rails_helper"
require Rails.root.join("lib", "ai_evals", "recommendation_behavior_runner")

# Unit-level specs for the behavioural eval runner.
#
# Full integration is deliberately NOT exercised here — that needs a real
# Anthropic API key and runs in the weekly CI workflow. These specs lock
# down the safety gates that prevent the runner from doing damage when
# misused (which is how the gate landed in the codebase: an accidental
# local run wiped a development database).
RSpec.describe AiEvals::RecommendationBehaviorRunner do
  describe "#reset_eval_state! safety gates" do
    let(:runner) { described_class.new(scenario_classes: []) }

    it "raises when the connected database does not end in '_test'" do
      allow(ActiveRecord::Base.connection).to receive(:current_database).and_return("resilience_development")
      ENV["AI_EVALS_ALLOW_DESTRUCTIVE_RESET"] = "1"

      expect {
        runner.send(:reset_eval_state!)
      }.to raise_error(AiEvals::RecommendationBehaviorRunner::SafetyViolation, /must end in '_test'/)
    ensure
      ENV.delete("AI_EVALS_ALLOW_DESTRUCTIVE_RESET")
    end

    it "raises when AI_EVALS_ALLOW_DESTRUCTIVE_RESET is not set" do
      allow(ActiveRecord::Base.connection).to receive(:current_database).and_return("resilience_test")
      ENV.delete("AI_EVALS_ALLOW_DESTRUCTIVE_RESET")

      expect {
        runner.send(:reset_eval_state!)
      }.to raise_error(AiEvals::RecommendationBehaviorRunner::SafetyViolation, /AI_EVALS_ALLOW_DESTRUCTIVE_RESET=1/)
    end

    it "raises when AI_EVALS_ALLOW_DESTRUCTIVE_RESET is set to anything other than '1'" do
      allow(ActiveRecord::Base.connection).to receive(:current_database).and_return("resilience_test")
      ENV["AI_EVALS_ALLOW_DESTRUCTIVE_RESET"] = "true" # not "1"

      expect {
        runner.send(:reset_eval_state!)
      }.to raise_error(AiEvals::RecommendationBehaviorRunner::SafetyViolation, /AI_EVALS_ALLOW_DESTRUCTIVE_RESET=1/)
    ensure
      ENV.delete("AI_EVALS_ALLOW_DESTRUCTIVE_RESET")
    end

    it "proceeds when both gates pass (test DB + explicit env opt-in)" do
      allow(ActiveRecord::Base.connection).to receive(:current_database).and_return("resilience_test")
      ENV["AI_EVALS_ALLOW_DESTRUCTIVE_RESET"] = "1"

      expect(ActiveRecord::Base.connection).to receive(:execute).with(/TRUNCATE TABLE/)

      expect { runner.send(:reset_eval_state!) }.not_to raise_error
    ensure
      ENV.delete("AI_EVALS_ALLOW_DESTRUCTIVE_RESET")
    end
  end

  describe "SafetyViolation propagation through run!" do
    # The runner's per-scenario rescue must NOT swallow SafetyViolation —
    # if it does, a misconfigured local run produces six fake "failed"
    # scenarios instead of an immediate, visible halt. This is the bug
    # the post-push review on 53a4be4 caught.
    it "lets SafetyViolation bubble out of run! instead of demoting it to a per-scenario failure" do
      # Build a runner with a single fake scenario class so we don't
      # need real scenario setup. The rescue layer is what we're
      # exercising.
      fake_scenario = Class.new do
        def name        = "fake"
        def description = "fake"
        def setup!(*)   ; end
        def expected    = []
      end

      runner = described_class.new(scenario_classes: [fake_scenario])

      # Wrong DB → SafetyViolation should propagate from run_scenario
      # all the way out of run!, not be caught by the broad
      # StandardError rescue inside run_scenario.
      allow(ActiveRecord::Base.connection).to receive(:current_database).and_return("resilience_development")
      ENV["AI_EVALS_ALLOW_DESTRUCTIVE_RESET"] = "1"
      allow(Metrics::Recorder).to receive(:reset!)

      expect {
        runner.run!
      }.to raise_error(AiEvals::RecommendationBehaviorRunner::SafetyViolation, /must end in '_test'/)
    ensure
      ENV.delete("AI_EVALS_ALLOW_DESTRUCTIVE_RESET")
    end
  end

  describe "scenario recommendation capture" do
    it "scores persisted recommendations without querying a nonexistent tenant column" do
      site_id = SecureRandom.uuid
      signal_id = SecureRandom.uuid

      fake_scenario = Class.new do
        define_method(:initialize) do |site_id:|
          @site_id = site_id
        end

        def name = "single-tenant-capture"
        def description = "captures recs from the reset single-tenant sandbox"
        def setup!(*) = nil

        def expected
          [
            {
              recommendation_type: "flag_site",
              must_include: true,
              entity_matcher: ->(rec) { rec[:affected_entity_type] == "Site" && rec[:affected_entity_id] == @site_id },
            },
          ]
        end
      end

      runner = described_class.new(scenario_classes: [fake_scenario])
      allow(runner).to receive(:reset_eval_state!)

      create(
        :recommendation,
        :llm,
        :for_site,
        recommendation_type: "flag_site",
        affected_entity_id: site_id,
        action_payload: { "site_id" => site_id },
      )
      create(
        :recommendation,
        recommendation_type: "acknowledge_alert",
        affected_entity_type: "SignalRuleMatch",
        affected_entity_id: signal_id,
        action_payload: { "alert_id" => signal_id, "to_status" => "acknowledged" },
      )

      allow(Recommendations::GeneratorService).to receive(:call).and_return(ServiceResult.success(created: 2))

      result = runner.send(:run_scenario, fake_scenario.new(site_id: site_id))

      expect(result).not_to have_key(:error)
      expect(result[:recall]).to eq(1.0)
      expect(result[:llm_recs]).to eq(1)
      expect(result[:rule_recs]).to eq(1)
    end
  end
end
