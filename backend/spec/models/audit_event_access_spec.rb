require "rails_helper"

RSpec.describe AuditEventAccess do
  describe "#initialize" do
    it "stores entity_type and entity_id" do
      access = described_class.new(entity_type: "Incident", entity_id: "abc-123")

      expect(access.entity_type).to eq("Incident")
      expect(access.entity_id).to eq("abc-123")
    end
  end

  describe "#entity_type" do
    it "is read-only" do
      access = described_class.new(entity_type: "Site", entity_id: "xyz")

      expect(access).to respond_to(:entity_type)
      expect(access).not_to respond_to(:entity_type=)
    end
  end

  describe "#entity_id" do
    it "is read-only" do
      access = described_class.new(entity_type: "Site", entity_id: "xyz")

      expect(access).to respond_to(:entity_id)
      expect(access).not_to respond_to(:entity_id=)
    end
  end
end
