require "rails_helper"

RSpec.describe CommanderIntentPolicy do
  let(:ao)     { create(:area_of_operation) }
  let(:intent) { create(:commander_intent, area_of_operation: ao) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, intent) }

      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
    end

    context "as operator" do
      subject { described_class.new(operator, intent) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
    end

    context "as viewer" do
      subject { described_class.new(viewer, intent) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
    end
  end

  describe "AO scoping" do
    let(:org)          { create(:organization) }
    let(:own_ao)       { create(:area_of_operation, organization: org) }
    let(:other_ao)     { create(:area_of_operation) }
    let(:scoped_user)  { create(:user, :commander, organization: org) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "allows show for intents in accessible AO" do
      own_intent = create(:commander_intent, area_of_operation: own_ao)
      expect(described_class.new(scoped_user, own_intent).show?).to be true
    end

    it "denies show for intents in inaccessible AO" do
      other_intent = create(:commander_intent, area_of_operation: other_ao)
      expect(described_class.new(scoped_user, other_intent).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)           { create(:organization) }
    let(:other_org)     { create(:organization) }
    let(:own_ao)        { create(:area_of_operation, organization: org) }
    let(:other_ao)      { create(:area_of_operation, organization: other_org) }
    let!(:own_intent)   { create(:commander_intent, area_of_operation: own_ao) }
    let!(:other_intent) { create(:commander_intent, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "returns all intents for unscoped users" do
      result = described_class::Scope.new(commander, CommanderIntent.all).resolve
      expect(result).to include(own_intent, other_intent)
    end

    it "returns only accessible intents for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, CommanderIntent.all).resolve
      expect(result).to include(own_intent)
      expect(result).not_to include(other_intent)
    end
  end
end
