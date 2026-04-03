require "rails_helper"

RSpec.describe AreaOfOperationPolicy do
  let(:ao)        { create(:area_of_operation) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, ao) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_destroy }
      it { is_expected.to be_update_posture }
    end

    context "as commander scoped to an AO" do
      let(:scoped_commander) { create(:user, :commander, area_of_operation: ao) }
      subject { described_class.new(scoped_commander, ao) }

      it { is_expected.not_to be_create }
    end

    context "as operator" do
      subject { described_class.new(operator, ao) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
      it { is_expected.not_to be_update_posture }
    end

    context "as viewer" do
      subject { described_class.new(viewer, ao) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end
  end

  describe "AO scoping" do
    let(:org)         { create(:organization) }
    let(:own_ao)      { create(:area_of_operation, organization: org) }
    let(:other_ao)    { create(:area_of_operation) }
    let(:scoped_user) { create(:user, :commander, organization: org) }

    it "allows show for AO in same org" do
      expect(described_class.new(scoped_user, own_ao).show?).to be true
    end

    it "denies show for AO in different org" do
      expect(described_class.new(scoped_user, other_ao).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)        { create(:organization) }
    let!(:own_ao)    { create(:area_of_operation, organization: org) }
    let(:other_org)  { create(:organization) }
    let!(:other_ao)  { create(:area_of_operation, organization: other_org) }

    it "returns all AOs for unscoped users" do
      result = described_class::Scope.new(commander, AreaOfOperation.all).resolve
      expect(result).to include(own_ao, other_ao)
    end

    it "returns only accessible AOs for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, AreaOfOperation.all).resolve
      expect(result).to include(own_ao)
      expect(result).not_to include(other_ao)
    end
  end
end
