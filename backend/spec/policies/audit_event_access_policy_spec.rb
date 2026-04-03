require "rails_helper"

RSpec.describe AuditEventAccessPolicy do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  describe "global access (blank entity)" do
    let(:access) { AuditEventAccess.new(entity_type: nil, entity_id: nil) }

    it "allows index for commander" do
      expect(described_class.new(commander, access).index?).to be true
    end

    it "denies index for operator" do
      expect(described_class.new(operator, access).index?).to be false
    end

    it "denies index for viewer" do
      expect(described_class.new(viewer, access).index?).to be false
    end
  end

  describe "entity-scoped access" do
    let(:access) { AuditEventAccess.new(entity_type: "Site", entity_id: SecureRandom.uuid) }

    it "allows index for any authenticated user" do
      expect(described_class.new(viewer, access).index?).to be true
      expect(described_class.new(operator, access).index?).to be true
      expect(described_class.new(commander, access).index?).to be true
    end
  end
end
