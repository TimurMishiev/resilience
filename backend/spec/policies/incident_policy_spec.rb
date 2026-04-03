require "rails_helper"

RSpec.describe IncidentPolicy do
  let(:site)      { create(:site) }
  let(:incident)  { create(:incident, site: site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, incident) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_update }
      it { is_expected.to be_transition }
      it { is_expected.to be_allowed_transitions }
      it { is_expected.to be_chain }
      it { is_expected.to be_list_notes }
      it { is_expected.to be_add_note }
      it { is_expected.to be_assign }
      it { is_expected.to be_initiate_prosecution }
      it { is_expected.to be_add_prosecution_step }
      it { is_expected.to be_list_prosecution_steps }
    end

    context "as operator" do
      subject { described_class.new(operator, incident) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_update }
      it { is_expected.to be_transition }
      it { is_expected.to be_assign }
      it { is_expected.to be_add_note }
      it { is_expected.not_to be_initiate_prosecution }
      it { is_expected.not_to be_add_prosecution_step }
    end

    context "as viewer" do
      subject { described_class.new(viewer, incident) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_transition }
      it { is_expected.not_to be_assign }
      it { is_expected.not_to be_add_note }
      it { is_expected.not_to be_initiate_prosecution }
      it { is_expected.to be_list_notes }
      it { is_expected.to be_list_prosecution_steps }
      it { is_expected.to be_chain }
    end
  end

  describe "site scoping" do
    let(:org)         { create(:organization) }
    let(:scoped_user) { create(:user, :operator, organization: org) }
    let(:own_site)    { create(:site, organization: org) }
    let(:other_site)  { create(:site) }

    it "allows show for incidents on accessible sites" do
      inc = create(:incident, site: own_site)
      expect(described_class.new(scoped_user, inc).show?).to be true
    end

    it "denies show for incidents on inaccessible sites" do
      inc = create(:incident, site: other_site)
      expect(described_class.new(scoped_user, inc).show?).to be false
    end
  end

  describe "area-only scoping" do
    let(:org)         { create(:organization) }
    let(:ao)          { create(:area_of_operation, organization: org) }
    let(:scoped_user) { create(:user, :operator, organization: org) }
    let(:other_ao)    { create(:area_of_operation) }

    it "allows show for incidents scoped to accessible AO (no site)" do
      create(:site, organization: org, area_of_operation: ao)
      inc = create(:incident, site: nil, area_of_operation: ao)
      expect(described_class.new(scoped_user, inc).show?).to be true
    end

    it "denies show for incidents scoped to inaccessible AO (no site)" do
      inc = create(:incident, site: nil, area_of_operation: other_ao)
      expect(described_class.new(scoped_user, inc).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:own_site)     { create(:site, organization: org, area_of_operation: ao) }
    let(:other_site)   { create(:site) }
    let!(:own_inc)     { create(:incident, site: own_site) }
    let!(:area_inc)    { create(:incident, site: nil, area_of_operation: ao) }
    let!(:foreign_inc) { create(:incident, site: other_site) }

    it "returns all incidents for unscoped users" do
      result = described_class::Scope.new(commander, Incident.all).resolve
      expect(result).to include(own_inc, area_inc, foreign_inc)
    end

    it "returns only accessible incidents for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, Incident.all).resolve
      expect(result).to include(own_inc, area_inc)
      expect(result).not_to include(foreign_inc)
    end
  end
end
