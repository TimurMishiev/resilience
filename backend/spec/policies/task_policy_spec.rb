require "rails_helper"

RSpec.describe TaskPolicy do
  let(:site)      { create(:site) }
  let(:task)      { create(:task, site: site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, task) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_transition }
      it { is_expected.to be_allowed_transitions }
    end

    context "as operator" do
      subject { described_class.new(operator, task) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_create }
      it { is_expected.to be_update }
      it { is_expected.to be_transition }
      it { is_expected.to be_allowed_transitions }
    end

    context "as viewer" do
      subject { described_class.new(viewer, task) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_create }
      it { is_expected.not_to be_update }
      it { is_expected.not_to be_transition }
      it { is_expected.to be_allowed_transitions }
    end
  end

  describe "site scoping" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:scoped_user)  { create(:user, :operator, organization: org) }
    let(:scoped_site)  { create(:site, organization: org, area_of_operation: ao) }
    let(:scoped_task)  { create(:task, site: scoped_site) }
    let(:foreign_site) { create(:site) }
    let(:foreign_task) { create(:task, site: foreign_site) }

    it "allows show for tasks on accessible sites" do
      expect(described_class.new(scoped_user, scoped_task).show?).to be true
    end

    it "denies show for tasks on inaccessible sites" do
      expect(described_class.new(scoped_user, foreign_task).show?).to be false
    end

    it "denies create for tasks on inaccessible sites" do
      expect(described_class.new(scoped_user, foreign_task).create?).to be false
    end
  end

  describe "Scope" do
    let(:org)          { create(:organization) }
    let(:ao)           { create(:area_of_operation, organization: org) }
    let(:scoped_site)  { create(:site, organization: org, area_of_operation: ao) }
    let(:foreign_site) { create(:site) }
    let!(:scoped_task)  { create(:task, site: scoped_site) }
    let!(:foreign_task) { create(:task, site: foreign_site) }

    it "returns all tasks for unscoped users" do
      result = described_class::Scope.new(commander, Task.all).resolve
      expect(result).to include(scoped_task, foreign_task)
    end

    it "returns only accessible tasks for org-scoped users" do
      scoped_user = create(:user, :operator, organization: org)
      result = described_class::Scope.new(scoped_user, Task.all).resolve
      expect(result).to include(scoped_task)
      expect(result).not_to include(foreign_task)
    end
  end
end
