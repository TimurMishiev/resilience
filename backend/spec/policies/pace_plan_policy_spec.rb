require "rails_helper"

RSpec.describe PacePlanPolicy do
  let(:ao)        { create(:area_of_operation) }
  let(:plan)      { create(:pace_plan, area_of_operation: ao) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, plan) }

      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
    end

    context "as operator" do
      subject { described_class.new(operator, plan) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
    end

    context "as viewer" do
      subject { described_class.new(viewer, plan) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
    end
  end

  describe "AO scoping" do
    let(:org)         { create(:organization) }
    let(:own_ao)      { create(:area_of_operation, organization: org) }
    let(:other_ao)    { create(:area_of_operation) }
    let(:scoped_user) { create(:user, :commander, organization: org) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "allows show for plans in accessible AO" do
      own_plan = create(:pace_plan, area_of_operation: own_ao)
      expect(described_class.new(scoped_user, own_plan).show?).to be true
    end

    it "denies show for plans in inaccessible AO" do
      other_plan = create(:pace_plan, area_of_operation: other_ao)
      expect(described_class.new(scoped_user, other_plan).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:other_org)    { create(:organization) }
    let(:own_ao)       { create(:area_of_operation, organization: org) }
    let(:other_ao)     { create(:area_of_operation, organization: other_org) }
    let!(:own_plan)    { create(:pace_plan, area_of_operation: own_ao) }
    let!(:other_plan)  { create(:pace_plan, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "returns all plans for unscoped users" do
      result = described_class::Scope.new(commander, PacePlan.all).resolve
      expect(result).to include(own_plan, other_plan)
    end

    it "returns only accessible plans for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, PacePlan.all).resolve
      expect(result).to include(own_plan)
      expect(result).not_to include(other_plan)
    end
  end
end
