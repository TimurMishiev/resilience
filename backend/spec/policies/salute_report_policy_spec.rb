require "rails_helper"

RSpec.describe SaluteReportPolicy do
  let(:ao)        { create(:area_of_operation) }
  let(:report)    { create(:salute_report, area_of_operation: ao) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, report) }

      it { is_expected.to be_show }
      it { is_expected.to be_create }
    end

    context "as operator" do
      subject { described_class.new(operator, report) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
    end

    context "as viewer" do
      subject { described_class.new(viewer, report) }

      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
    end
  end

  describe "AO scoping" do
    let(:org)         { create(:organization) }
    let(:own_ao)      { create(:area_of_operation, organization: org) }
    let(:other_ao)    { create(:area_of_operation) }
    let(:scoped_user) { create(:user, :commander, organization: org) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "allows show for reports in accessible AO" do
      own_report = create(:salute_report, area_of_operation: own_ao)
      expect(described_class.new(scoped_user, own_report).show?).to be true
    end

    it "denies show for reports in inaccessible AO" do
      other_report = create(:salute_report, area_of_operation: other_ao)
      expect(described_class.new(scoped_user, other_report).show?).to be false
    end
  end

  describe "Scope" do
    let(:org)            { create(:organization) }
    let(:other_org)      { create(:organization) }
    let(:own_ao)         { create(:area_of_operation, organization: org) }
    let(:other_ao)       { create(:area_of_operation, organization: other_org) }
    let!(:own_report)    { create(:salute_report, area_of_operation: own_ao) }
    let!(:other_report)  { create(:salute_report, area_of_operation: other_ao) }

    before { create(:site, organization: org, area_of_operation: own_ao) }

    it "returns all reports for unscoped users" do
      result = described_class::Scope.new(commander, SaluteReport.all).resolve
      expect(result).to include(own_report, other_report)
    end

    it "returns only accessible reports for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, SaluteReport.all).resolve
      expect(result).to include(own_report)
      expect(result).not_to include(other_report)
    end
  end
end
