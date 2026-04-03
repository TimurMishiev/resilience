require "rails_helper"

RSpec.describe RecommendationPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  let(:recommendation) do
    create(:recommendation, affected_entity_type: "Site", affected_entity_id: site.id)
  end

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, recommendation) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_metrics }
      it { is_expected.to be_generate }
      it { is_expected.to be_accept }
      it { is_expected.to be_reject }
      it { is_expected.to be_defer }
      it { is_expected.to be_execute }
    end

    context "as operator" do
      subject { described_class.new(operator, recommendation) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_metrics }
      it { is_expected.not_to be_generate }
      it { is_expected.not_to be_accept }
      it { is_expected.not_to be_reject }
      it { is_expected.not_to be_defer }
      it { is_expected.not_to be_execute }
    end

    context "as viewer" do
      subject { described_class.new(viewer, recommendation) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_metrics }
      it { is_expected.not_to be_generate }
      it { is_expected.not_to be_accept }
    end
  end

  describe "generate requires unscoped commander" do
    let(:org) { create(:organization) }
    let(:scoped_commander) { create(:user, :commander, organization: org) }

    it "denies generate for scope-restricted commanders" do
      expect(described_class.new(scoped_commander, recommendation).generate?).to be false
    end
  end

  describe "entity accessibility" do
    let(:org)         { create(:organization) }
    let(:ao)          { create(:area_of_operation, organization: org) }
    let(:scoped_user) { create(:user, :commander, organization: org) }
    let(:own_site)    { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)  { create(:site) }

    it "allows show for recommendations targeting accessible entities" do
      rec = create(:recommendation, affected_entity_type: "Site", affected_entity_id: own_site.id)
      expect(described_class.new(scoped_user, rec).show?).to be true
    end

    it "denies show for recommendations targeting inaccessible entities" do
      rec = create(:recommendation, affected_entity_type: "Site", affected_entity_id: other_site.id)
      expect(described_class.new(scoped_user, rec).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:own_site)     { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)   { create(:site) }
    let!(:own_rec)     { create(:recommendation, affected_entity_type: "Site", affected_entity_id: own_site.id) }
    let!(:other_rec)   { create(:recommendation, affected_entity_type: "Site", affected_entity_id: other_site.id) }

    it "returns all recommendations for unscoped users" do
      result = described_class::Scope.new(commander, Recommendation.all).resolve
      expect(result).to include(own_rec, other_rec)
    end

    it "returns only accessible recommendations for org-scoped users" do
      scoped_user = create(:user, :commander, organization: org)
      result = described_class::Scope.new(scoped_user, Recommendation.all).resolve
      expect(result).to include(own_rec)
      expect(result).not_to include(other_rec)
    end
  end
end
