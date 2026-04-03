require "rails_helper"

RSpec.describe SitePolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_risk_history }
      it { is_expected.to be_timeline }
      it { is_expected.to be_toggle_status }
      it { is_expected.to be_update_geofence }
      it { is_expected.to be_unflag }
    end

    context "as operator" do
      subject { described_class.new(operator, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_risk_history }
      it { is_expected.to be_timeline }
      it { is_expected.not_to be_toggle_status }
      it { is_expected.not_to be_update_geofence }
      it { is_expected.not_to be_unflag }
    end

    context "as viewer" do
      subject { described_class.new(viewer, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_toggle_status }
      it { is_expected.not_to be_update_geofence }
      it { is_expected.not_to be_unflag }
    end
  end

  describe "site scoping" do
    let(:org)         { create(:organization) }
    let(:ao)          { create(:area_of_operation, organization: org) }
    let(:scoped_user) { create(:user, :operator, organization: org) }
    let(:own_site)    { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)  { create(:site) }

    it "allows show for sites in same org" do
      expect(described_class.new(scoped_user, own_site).show?).to be true
    end

    it "denies show for sites in other org" do
      expect(described_class.new(scoped_user, other_site).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let!(:own_site)    { create(:site, organization: org, area_of_operation: ao) }
    let!(:other_site)  { create(:site) }

    it "returns all sites for unscoped users" do
      result = described_class::Scope.new(commander, Site.all).resolve
      expect(result).to include(own_site, other_site)
    end

    it "returns only accessible sites for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, Site.all).resolve
      expect(result).to include(own_site)
      expect(result).not_to include(other_site)
    end
  end
end
