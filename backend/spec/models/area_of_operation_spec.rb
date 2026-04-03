require "rails_helper"

RSpec.describe AreaOfOperation, type: :model do
  describe "organization scoping" do
    let(:organization) { create(:organization) }
    let(:other_organization) { create(:organization) }
    let(:creator) { create(:user, :commander, organization: organization) }

    it "is valid when organization matches the creator scope" do
      area = build(:area_of_operation, created_by: creator, organization: organization)

      expect(area).to be_valid
    end

    it "is invalid when organization does not match the creator scope" do
      area = build(:area_of_operation, created_by: creator, organization: other_organization)

      expect(area).not_to be_valid
      expect(area.errors[:organization_id]).to include("must match the creator's organization scope")
    end
  end
end
