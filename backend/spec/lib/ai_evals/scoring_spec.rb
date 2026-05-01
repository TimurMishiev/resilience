require "rails_helper"
require Rails.root.join("lib", "ai_evals", "scoring")

RSpec.describe AiEvals::Scoring do
  # Minimal scenario double — same shape as Scenarios::BaseScenario
  # subclasses but built inline so each spec can pin its expectations
  # without setting up DB state.
  let(:scenario) do
    instance_double(
      "AiEvals::Scenarios::BaseScenario",
      name:        "spec_scenario",
      description: "spec scenario",
      expected:    expectations,
    )
  end

  describe ".matches?" do
    it "matches on recommendation_type when no entity_matcher is supplied" do
      rec = { recommendation_type: "flag_site", affected_entity_type: "Site", affected_entity_id: "abc" }
      exp = { recommendation_type: "flag_site" }
      expect(described_class.matches?(rec, exp)).to be(true)
    end

    it "rejects mismatched recommendation_type" do
      rec = { recommendation_type: "create_task" }
      exp = { recommendation_type: "flag_site" }
      expect(described_class.matches?(rec, exp)).to be(false)
    end

    it "applies entity_matcher when supplied" do
      rec = { recommendation_type: "flag_site", affected_entity_id: "site-1" }
      exp = {
        recommendation_type: "flag_site",
        entity_matcher: ->(r) { r[:affected_entity_id] == "site-1" },
      }
      expect(described_class.matches?(rec, exp)).to be(true)
    end

    it "rejects when entity_matcher returns false" do
      rec = { recommendation_type: "flag_site", affected_entity_id: "site-2" }
      exp = {
        recommendation_type: "flag_site",
        entity_matcher: ->(r) { r[:affected_entity_id] == "site-1" },
      }
      expect(described_class.matches?(rec, exp)).to be(false)
    end
  end

  describe ".score_scenario" do
    context "with a single must_include expectation that's satisfied" do
      let(:expectations) do
        [{ recommendation_type: "flag_site", must_include: true }]
      end

      it "scores recall=1.0, precision=1.0 (vacuous on must_exclude)" do
        recs = [{ recommendation_type: "flag_site" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(1.0)
        expect(result[:precision]).to eq(1.0)
        expect(result[:include][:satisfied]).to eq(1)
        expect(result[:include][:total]).to eq(1)
      end
    end

    context "with a must_include expectation that's not satisfied" do
      let(:expectations) do
        [{ recommendation_type: "flag_site", must_include: true }]
      end

      it "scores recall=0.0" do
        recs = [{ recommendation_type: "create_task" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(0.0)
      end
    end

    context "with a must_exclude expectation that the model violated" do
      let(:expectations) do
        [{ recommendation_type: "assign_asset", must_exclude: true }]
      end

      it "scores precision=0.0" do
        recs = [{ recommendation_type: "assign_asset" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:precision]).to eq(0.0)
      end
    end

    context "with a must_exclude expectation the model correctly avoided" do
      let(:expectations) do
        [{ recommendation_type: "assign_asset", must_exclude: true }]
      end

      it "scores precision=1.0" do
        recs = [{ recommendation_type: "create_task" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:precision]).to eq(1.0)
      end
    end

    context "with mixed include + exclude expectations" do
      let(:expectations) do
        [
          { recommendation_type: "flag_site",   must_include: true },
          { recommendation_type: "assign_asset", must_exclude: true },
        ]
      end

      it "scores both dimensions independently" do
        recs = [{ recommendation_type: "flag_site" }] # satisfies include, avoids exclude
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(1.0)
        expect(result[:precision]).to eq(1.0)
      end

      it "penalises a violated exclude even when include is satisfied" do
        recs = [
          { recommendation_type: "flag_site" },
          { recommendation_type: "assign_asset" },
        ]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(1.0)
        expect(result[:precision]).to eq(0.0)
      end
    end

    context "vacuous expectations (empty include list)" do
      let(:expectations) do
        [{ recommendation_type: "flag_site", must_exclude: true }]
      end

      it "treats recall as 1.0 when there are no must_include expectations" do
        recs = []
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(1.0)
      end
    end

    context "entity_matcher narrowing" do
      let(:expectations) do
        [
          {
            recommendation_type: "flag_site",
            must_include:        true,
            entity_matcher:      ->(r) { r[:affected_entity_id] == "target-site" },
          },
        ]
      end

      it "rejects a flag_site rec against the wrong entity as not satisfying the include" do
        recs = [{ recommendation_type: "flag_site", affected_entity_id: "other-site" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(0.0)
      end

      it "satisfies the include when the rec targets the right entity" do
        recs = [{ recommendation_type: "flag_site", affected_entity_id: "target-site" }]
        result = described_class.score_scenario(scenario: scenario, recommendations: recs)
        expect(result[:recall]).to eq(1.0)
      end
    end
  end

  describe ".aggregate" do
    it "micro-averages across multiple scenario scores" do
      scores = [
        { include: { satisfied: 2, total: 2, results: [] }, exclude: { satisfied: 1, total: 1, results: [] } },
        { include: { satisfied: 1, total: 2, results: [] }, exclude: { satisfied: 0, total: 1, results: [] } },
        { include: { satisfied: 0, total: 0, results: [] }, exclude: { satisfied: 1, total: 1, results: [] } },
      ]
      result = described_class.aggregate(scores)
      # 3 of 4 must_include expectations satisfied → recall = 0.75
      expect(result[:recall]).to be_within(0.001).of(0.75)
      # 2 of 3 must_exclude expectations correctly avoided → precision ≈ 0.667
      expect(result[:precision]).to be_within(0.001).of(2.0 / 3)
      expect(result[:scenarios_run]).to eq(3)
      expect(result[:include_hits]).to eq(3)
      expect(result[:include_total]).to eq(4)
      expect(result[:exclude_hits]).to eq(2)
      expect(result[:exclude_total]).to eq(3)
    end

    it "returns vacuous 1.0 / 1.0 when no expectations exist anywhere" do
      scores = [
        { include: { satisfied: 0, total: 0, results: [] }, exclude: { satisfied: 0, total: 0, results: [] } },
      ]
      result = described_class.aggregate(scores)
      expect(result[:recall]).to eq(1.0)
      expect(result[:precision]).to eq(1.0)
    end
  end
end
