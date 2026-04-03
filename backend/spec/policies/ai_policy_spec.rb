require "rails_helper"

RSpec.describe AiPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, site) }

      it { is_expected.to be_filter }
      it { is_expected.to be_ontology_query }
      it { is_expected.to be_export }
      it { is_expected.to be_summary }
    end

    context "as operator" do
      subject { described_class.new(operator, site) }

      it { is_expected.not_to be_filter }
      it { is_expected.not_to be_ontology_query }
      it { is_expected.not_to be_export }
      it { is_expected.not_to be_summary }
    end

    context "as viewer" do
      subject { described_class.new(viewer, site) }

      it { is_expected.not_to be_filter }
      it { is_expected.not_to be_ontology_query }
      it { is_expected.not_to be_export }
      it { is_expected.not_to be_summary }
    end
  end
end
