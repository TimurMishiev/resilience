require "rails_helper"

RSpec.describe CorrelationRulePolicy do
  let(:ao)        { create(:area_of_operation) }
  let(:rule)      { create(:correlation_rule, area_of_operation: ao) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, rule) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_effectiveness }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_destroy }
      it { is_expected.to be_dry_run }
    end

    context "as operator" do
      subject { described_class.new(operator, rule) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_effectiveness }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
      it { is_expected.not_to be_dry_run }
    end

    context "as viewer" do
      subject { described_class.new(viewer, rule) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_effectiveness }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
    end
  end

  describe "AO scoping" do
    let(:org)         { create(:organization) }
    let(:own_ao)      { create(:area_of_operation, organization: org) }
    let(:other_ao)    { create(:area_of_operation) }
    let(:scoped_user) { create(:user, :commander, organization: org) }
    let(:own_rule)    { create(:correlation_rule, area_of_operation: own_ao) }
    let(:other_rule)  { create(:correlation_rule, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "allows show for rules in accessible AO" do
      expect(described_class.new(scoped_user, own_rule).show?).to be true
    end

    it "denies show for rules in inaccessible AO" do
      expect(described_class.new(scoped_user, other_rule).show?).to be false
    end

    it "denies create for rules in inaccessible AO" do
      expect(described_class.new(scoped_user, other_rule).create?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:other_org)    { create(:organization) }
    let(:own_ao)       { create(:area_of_operation, organization: org) }
    let(:other_ao)     { create(:area_of_operation, organization: other_org) }
    let!(:own_rule)    { create(:correlation_rule, area_of_operation: own_ao) }
    let!(:other_rule)  { create(:correlation_rule, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "returns all rules for unscoped users" do
      result = described_class::Scope.new(commander, CorrelationRule.all).resolve
      expect(result).to include(own_rule, other_rule)
    end

    it "returns only accessible rules for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, CorrelationRule.all).resolve
      expect(result).to include(own_rule)
      expect(result).not_to include(other_rule)
    end
  end
end
