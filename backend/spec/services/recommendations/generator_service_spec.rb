require "rails_helper"

RSpec.describe Recommendations::GeneratorService, type: :service do
  subject(:result) { described_class.call }

  let!(:site)  { create(:site) }

  describe "with stale low-confidence alerts" do
    let!(:match) do
      create(:signal_rule_match,
             site:             site,
             workflow_status:  "unacknowledged",
             confidence:       0.25,
             fired_at:         8.hours.ago)
    end

    it "succeeds and creates at least one recommendation" do
      expect(result).to be_success
      expect(result.created).to be >= 1
      expect(Recommendation.pending.count).to be >= 1
    end

    it "does not create duplicates on second run" do
      described_class.call
      count_after_first = Recommendation.count

      described_class.call
      expect(Recommendation.count).to eq count_after_first
    end
  end

  describe "with no triggering data" do
    it "succeeds with zero created" do
      expect(result).to be_success
      expect(result.created).to eq 0
    end
  end

  describe "expiry" do
    it "marks stale pending recs as expired" do
      create(:recommendation, :expired, status: "pending")
      described_class.call
      expect(Recommendation.pending.where("expires_at <= ?", Time.current)).to be_empty
    end
  end
end
