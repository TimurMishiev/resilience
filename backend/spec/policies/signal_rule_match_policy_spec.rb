require "rails_helper"

RSpec.describe SignalRuleMatchPolicy do
  let(:site)      { create(:site) }
  let(:match)     { create(:signal_rule_match, site: site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, match) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_transition }
      it { is_expected.to be_allowed_transitions }
      it { is_expected.to be_bulk_transition }
      it { is_expected.to be_active_breach_sites }
      it { is_expected.to be_active_site_confidence }
    end

    context "as operator" do
      subject { described_class.new(operator, match) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_transition }
      it { is_expected.to be_allowed_transitions }
      it { is_expected.to be_bulk_transition }
      it { is_expected.to be_active_breach_sites }
      it { is_expected.to be_active_site_confidence }
    end

    context "as viewer" do
      subject { described_class.new(viewer, match) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_transition }
      it { is_expected.to be_allowed_transitions }
      it { is_expected.not_to be_bulk_transition }
      it { is_expected.to be_active_breach_sites }
      it { is_expected.to be_active_site_confidence }
    end
  end

  describe "site scoping" do
    let(:org)         { create(:organization) }
    let(:ao)          { create(:area_of_operation, organization: org) }
    let(:scoped_user) { create(:user, :operator, organization: org) }
    let(:own_site)    { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)  { create(:site) }

    it "allows show for matches on accessible sites" do
      own_match = create(:signal_rule_match, site: own_site)
      expect(described_class.new(scoped_user, own_match).show?).to be true
    end

    it "denies show for matches on inaccessible sites" do
      other_match = create(:signal_rule_match, site: other_site)
      expect(described_class.new(scoped_user, other_match).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:own_site)     { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)   { create(:site) }
    let!(:own_match)   { create(:signal_rule_match, site: own_site) }
    let!(:other_match) { create(:signal_rule_match, site: other_site) }

    it "returns all matches for unscoped users" do
      result = described_class::Scope.new(commander, SignalRuleMatch.all).resolve
      expect(result).to include(own_match, other_match)
    end

    it "returns only accessible matches for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, SignalRuleMatch.all).resolve
      expect(result).to include(own_match)
      expect(result).not_to include(other_match)
    end
  end
end
