require "rails_helper"

RSpec.describe UserPolicy do
  let(:admin)     { create(:user, :admin) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    context "as admin" do
      subject { described_class.new(admin, commander) }

      it { is_expected.to be_index }
      it { is_expected.to be_show }
      it { is_expected.to be_update }
    end

    context "as commander" do
      subject { described_class.new(commander, operator) }

      it { is_expected.not_to be_index }
      it { is_expected.not_to be_show }
      it { is_expected.not_to be_update }
    end

    context "as user viewing self" do
      subject { described_class.new(operator, operator) }

      it { is_expected.not_to be_index }
      it { is_expected.to be_show }
      it { is_expected.not_to be_update }
    end

    context "as viewer" do
      subject { described_class.new(viewer, operator) }

      it { is_expected.not_to be_index }
      it { is_expected.not_to be_show }
      it { is_expected.not_to be_update }
    end
  end

  describe "Scope" do
    let!(:user_a) { create(:user, :operator) }
    let!(:user_b) { create(:user, :viewer) }

    it "returns all users for admin" do
      result = described_class::Scope.new(admin, User.all).resolve
      expect(result).to include(user_a, user_b)
    end

    it "returns only self for non-admin" do
      result = described_class::Scope.new(user_a, User.all).resolve
      expect(result).to contain_exactly(user_a)
    end
  end
end
