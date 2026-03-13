require "rails_helper"

RSpec.describe Readiness::CalculationService, type: :service do
  let(:site) { create(:site) }

  subject(:result) { described_class.call(site: site, tasks: tasks) }

  context "when the site has no tasks" do
    let(:tasks) { Task.none }

    it "returns success" do
      expect(result.success).to be true
    end

    it "returns nil score" do
      expect(result.payload[:score]).to be_nil
    end

    it "returns zero counts" do
      expect(result.payload[:counts][:total]).to eq(0)
    end
  end

  context "when all tasks are resolved" do
    let(:tasks) { create_list(:task, 3, :resolved, site: site) }

    it "returns a perfect score of 1.0" do
      # resolved_ratio = 3/3 = 1.0, non_blocked_ratio = 3/3 = 1.0
      # score = (1.0 * 0.6) + (1.0 * 0.4) = 1.0
      expect(result.payload[:score]).to eq(1.0)
    end
  end

  context "when all tasks are blocked" do
    let(:tasks) { create_list(:task, 4, :blocked, site: site) }

    it "returns a score of 0.0" do
      # resolved_ratio = 0/4 = 0.0, non_blocked_ratio = 0/4 = 0.0
      # score = 0.0
      expect(result.payload[:score]).to eq(0.0)
    end

    it "reports correct blocked count" do
      expect(result.payload[:counts][:blocked]).to eq(4)
    end
  end

  context "with a mixed task set" do
    let(:tasks) do
      [
        create(:task, :resolved, site: site),
        create(:task, :resolved, site: site),
        create(:task, :in_progress, site: site),
        create(:task, :blocked, site: site)
      ]
    end

    it "calculates the correct score" do
      # total=4, resolved=2, non_blocked=3 (all except the 1 blocked)
      # resolved_ratio = 2/4 = 0.5
      # non_blocked_ratio = 3/4 = 0.75
      # score = (0.5 * 0.6) + (0.75 * 0.4) = 0.30 + 0.30 = 0.60
      expect(result.payload[:score]).to eq(0.60)
    end

    it "returns correct counts" do
      counts = result.payload[:counts]
      expect(counts[:total]).to eq(4)
      expect(counts[:resolved]).to eq(2)
      expect(counts[:blocked]).to eq(1)
      expect(counts[:non_blocked]).to eq(3)
    end
  end

  context "when resolved_weight and non_blocked_weight are applied correctly" do
    let(:tasks) do
      [
        create(:task, :resolved, site: site),
        create(:task, site: site),
        create(:task, site: site),
        create(:task, site: site)
      ]
    end

    it "weights resolved tasks at 0.6" do
      # resolved_ratio = 1/4 = 0.25, non_blocked_ratio = 4/4 = 1.0
      # score = (0.25 * 0.6) + (1.0 * 0.4) = 0.15 + 0.40 = 0.55
      expect(result.payload[:score]).to eq(0.55)
    end
  end
end
