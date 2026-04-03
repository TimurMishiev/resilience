require "rails_helper"

RSpec.describe OperationalHealthPolicy do
  let(:site)      { create(:site) }
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "permissions" do
    it "allows index for commander" do
      expect(described_class.new(commander, site).index?).to be true
    end

    it "denies index for operator" do
      expect(described_class.new(operator, site).index?).to be false
    end

    it "denies index for viewer" do
      expect(described_class.new(viewer, site).index?).to be false
    end
  end
end
