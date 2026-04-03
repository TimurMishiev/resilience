require "rails_helper"

RSpec.describe ChokepointPolicy do
  let(:ao)         { create(:area_of_operation) }
  let(:chokepoint) { create(:chokepoint, area_of_operation: ao) }
  let(:commander)  { create(:user, :commander) }
  let(:operator)   { create(:user, :operator) }
  let(:viewer)     { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, chokepoint) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_destroy }
    end

    context "as operator" do
      subject { described_class.new(operator, chokepoint) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end

    context "as viewer" do
      subject { described_class.new(viewer, chokepoint) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
    end
  end

  describe "AO scoping" do
    let(:org)            { create(:organization) }
    let(:own_ao)         { create(:area_of_operation, organization: org) }
    let(:other_ao)       { create(:area_of_operation) }
    let(:scoped_user)    { create(:user, :commander, organization: org) }
    let(:own_chokepoint) { create(:chokepoint, area_of_operation: own_ao) }
    let(:other_chokepoint) { create(:chokepoint, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "allows show for chokepoints in accessible AO" do
      expect(described_class.new(scoped_user, own_chokepoint).show?).to be true
    end

    it "denies show for chokepoints in inaccessible AO" do
      expect(described_class.new(scoped_user, other_chokepoint).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)               { create(:organization) }
    let(:other_org)         { create(:organization) }
    let(:own_ao)            { create(:area_of_operation, organization: org) }
    let(:other_ao)          { create(:area_of_operation, organization: other_org) }
    let!(:own_chokepoint)   { create(:chokepoint, area_of_operation: own_ao) }
    let!(:other_chokepoint) { create(:chokepoint, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "returns all chokepoints for unscoped users" do
      result = described_class::Scope.new(commander, Chokepoint.all).resolve
      expect(result).to include(own_chokepoint, other_chokepoint)
    end

    it "returns only accessible chokepoints for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, Chokepoint.all).resolve
      expect(result).to include(own_chokepoint)
      expect(result).not_to include(other_chokepoint)
    end
  end
end
