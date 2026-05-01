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
end
