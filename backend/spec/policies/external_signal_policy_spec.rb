require "rails_helper"

RSpec.describe ExternalSignalPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as commander" do
      subject { described_class.new(commander, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_stream }
      it { is_expected.to be_create }
    end

    context "as operator" do
      subject { described_class.new(operator, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_stream }
      it { is_expected.not_to be_create }
    end

    context "as viewer" do
      subject { described_class.new(viewer, site) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_stream }
      it { is_expected.not_to be_create }
    end
  end
end
