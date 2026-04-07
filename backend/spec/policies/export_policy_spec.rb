require "rails_helper"

RSpec.describe ExportPolicy do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }
  let(:admin)     { create(:user, :admin) }

  describe "permissions" do
    context "as admin" do
      subject { described_class.new(admin, :export) }

      it { is_expected.to be_create }
    end

    context "as commander" do
      subject { described_class.new(commander, :export) }

      it { is_expected.to be_create }
    end

    context "as operator" do
      subject { described_class.new(operator, :export) }

      it { is_expected.to be_create }
    end

    context "as viewer" do
      subject { described_class.new(viewer, :export) }

      it { is_expected.to be_create }
    end
  end
end
