require "rails_helper"

RSpec.describe AssetPolicy do
  let(:site)      { create(:site) }
  let(:asset)     { create(:asset, home_site: site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, asset) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_update }
    end

    context "as operator" do
      subject { described_class.new(operator, asset) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_update }
    end

    context "as viewer" do
      subject { described_class.new(viewer, asset) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_update }
    end
  end

  describe "site scoping" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:scoped_user)  { create(:user, :operator, organization: org) }
    let(:own_site)     { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)   { create(:site) }
    let(:own_asset)    { create(:asset, home_site: own_site) }
    let(:other_asset)  { create(:asset, home_site: other_site) }

    it "allows show for assets on accessible sites" do
      expect(described_class.new(scoped_user, own_asset).show?).to be true
    end

    it "denies show for assets on inaccessible sites" do
      expect(described_class.new(scoped_user, other_asset).show?).to be false
    end

    it "denies update even for commander on inaccessible site" do
      scoped_commander = create(:user, :commander, organization: org)
      expect(described_class.new(scoped_commander, other_asset).update?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:own_site)     { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)   { create(:site) }
    let!(:own_asset)   { create(:asset, home_site: own_site) }
    let!(:other_asset) { create(:asset, home_site: other_site) }

    it "returns all assets for unscoped users" do
      result = described_class::Scope.new(commander, Asset.all).resolve
      expect(result).to include(own_asset, other_asset)
    end

    it "returns only accessible assets for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, Asset.all).resolve
      expect(result).to include(own_asset)
      expect(result).not_to include(other_asset)
    end
  end
end
