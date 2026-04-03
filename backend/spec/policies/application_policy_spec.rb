require "rails_helper"

RSpec.describe ApplicationPolicy do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }
  let(:site)      { create(:site) }

  describe "defaults" do
    subject { described_class.new(user, site) }

    context "as commander" do
      let(:user) { commander }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_destroy }
    end

    context "as operator" do
      let(:user) { operator }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end

    context "as viewer" do
      let(:user) { viewer }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_destroy }
    end
  end

  describe "unauthenticated" do
    it "raises when user is nil" do
      expect { described_class.new(nil, site) }.to raise_error(Pundit::NotAuthorizedError)
    end
  end

  describe "#scope_restricted?" do
    it "returns false for users without org or AO" do
      policy = described_class.new(commander, site)
      expect(policy.send(:scope_restricted?)).to be false
    end

    it "returns true for users with organization_id" do
      org = create(:organization)
      user = create(:user, :commander, organization: org)
      policy = described_class.new(user, site)
      expect(policy.send(:scope_restricted?)).to be true
    end

    it "returns true for users with area_of_operation_id" do
      ao = create(:area_of_operation)
      user = create(:user, :commander, area_of_operation: ao)
      policy = described_class.new(user, site)
      expect(policy.send(:scope_restricted?)).to be true
    end
  end

  describe "#site_accessible?" do
    let(:org)  { create(:organization) }
    let(:ao)   { create(:area_of_operation, organization: org) }
    let(:scoped_site) { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)  { create(:site) }

    context "unscoped user" do
      it "returns true for any site" do
        policy = described_class.new(commander, other_site)
        expect(policy.send(:site_accessible?, other_site)).to be true
      end
    end

    context "org-scoped user" do
      let(:user) { create(:user, :commander, organization: org) }

      it "returns true for sites in same org" do
        policy = described_class.new(user, scoped_site)
        expect(policy.send(:site_accessible?, scoped_site)).to be true
      end

      it "returns false for sites in different org" do
        policy = described_class.new(user, other_site)
        expect(policy.send(:site_accessible?, other_site)).to be false
      end

      it "returns false for nil site" do
        policy = described_class.new(user, site)
        expect(policy.send(:site_accessible?, nil)).to be false
      end
    end

    context "AO-scoped user" do
      let(:user) { create(:user, :commander, area_of_operation: ao) }

      it "returns true for sites in same AO" do
        policy = described_class.new(user, scoped_site)
        expect(policy.send(:site_accessible?, scoped_site)).to be true
      end

      it "returns false for sites in different AO" do
        policy = described_class.new(user, other_site)
        expect(policy.send(:site_accessible?, other_site)).to be false
      end
    end
  end

  describe "#incident_accessible?" do
    let(:org)      { create(:organization) }
    let(:ao)       { create(:area_of_operation, organization: org) }
    let(:user)     { create(:user, :commander, organization: org) }
    let(:own_site) { create(:site, organization: org, area_of_operation: ao) }

    it "delegates to site_accessible? when incident has a site" do
      incident = create(:incident, site: own_site)
      policy = described_class.new(user, incident)
      expect(policy.send(:incident_accessible?, incident)).to be true
    end

    it "delegates to area_of_operation_accessible? when incident has no site" do
      create(:site, organization: org, area_of_operation: ao)
      incident = create(:incident, site: nil, area_of_operation: ao)
      policy = described_class.new(user, incident)
      expect(policy.send(:incident_accessible?, incident)).to be true
    end
  end
end
