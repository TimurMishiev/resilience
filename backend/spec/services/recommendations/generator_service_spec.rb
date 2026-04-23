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

  describe "tenant scoping (MT2)" do
    let(:org_a) { create(:organization) }
    let(:org_b) { create(:organization) }
    let(:site_a) { create(:site, organization: org_a) }
    let(:site_b) { create(:site, organization: org_b) }

    it "generates recommendations only for the scoped tenant's entities" do
      match_a = create(:signal_rule_match,
                       site: site_a, workflow_status: "unacknowledged",
                       confidence: 0.25, fired_at: 8.hours.ago, auto_task: false)
      match_b = create(:signal_rule_match,
                       site: site_b, workflow_status: "unacknowledged",
                       confidence: 0.25, fired_at: 8.hours.ago, auto_task: false)

      result = described_class.call(organization_id: org_a.id)
      expect(result).to be_success

      entity_ids = Recommendation
        .where(affected_entity_type: "SignalRuleMatch")
        .pluck(:affected_entity_id)
      expect(entity_ids).to include(match_a.id)
      expect(entity_ids).not_to include(match_b.id)
    end

    it "threads organization_id into ContextAssembler" do
      expect(Recommendations::ContextAssembler)
        .to receive(:call)
        .with(organization_id: org_a.id)
        .and_return(ServiceResult.success(context: {}))
      allow(Recommendations::RuleEngine).to receive(:call).and_return(ServiceResult.success(recommendations: []))
      allow(Recommendations::LlmEnricher).to receive(:call).and_return(ServiceResult.success(recommendations: []))
      allow(Recommendations::Validator).to receive(:call).and_return(ServiceResult.success(valid: [], invalid: []))

      described_class.call(organization_id: org_a.id)
    end
  end
end
