require "rails_helper"

RSpec.describe OrganizationPolicy do
  let(:org)       { create(:organization) }
  let(:admin)     { create(:user, :admin) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as admin" do
      subject { described_class.new(admin, org) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_destroy }
    end

    context "as commander" do
      subject { described_class.new(commander, org) }

      it { is_expected.not_to be_index }
      it { is_expected.not_to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end

    context "as operator" do
      subject { described_class.new(operator, org) }

      it { is_expected.not_to be_index }
      it { is_expected.not_to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end

    context "as viewer" do
      subject { described_class.new(viewer, org) }

      it { is_expected.not_to be_index }
      it { is_expected.not_to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end

    context "as org member (show? via own_organization?)" do
      let(:member) { create(:user, :operator, organization: org) }
      subject { described_class.new(member, org) }

      it { is_expected.not_to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end
  end

  describe "Scope" do
    let!(:org_a) { create(:organization) }
    let!(:org_b) { create(:organization) }

    it "returns all organizations for admin" do
      result = described_class::Scope.new(admin, Organization.all).resolve
      expect(result).to include(org_a, org_b)
    end

    it "returns only own organization for org-scoped user" do
      scoped_user = create(:user, :operator, organization: org_a)
      result = described_class::Scope.new(scoped_user, Organization.all).resolve
      expect(result).to contain_exactly(org_a)
    end

    it "returns none for user without organization" do
      result = described_class::Scope.new(commander, Organization.all).resolve
      expect(result).to be_empty
    end
  end
end
