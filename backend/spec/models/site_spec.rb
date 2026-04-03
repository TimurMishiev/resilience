require "rails_helper"

RSpec.describe Site, type: :model do
  describe "organization alignment" do
    let(:organization) { create(:organization) }
    let(:other_organization) { create(:organization) }
    let(:creator) { create(:user, :commander, organization: organization) }
    let(:area) { create(:area_of_operation, created_by: creator, organization: organization) }
    let(:other_area) { create(:area_of_operation, created_by: create(:user, :commander, organization: other_organization), organization: other_organization) }

    it "inherits organization from its area of operation when blank" do
      site = build(:site, organization: nil, area_of_operation: area)

      expect(site).to be_valid
      expect(site.organization).to eq(organization)
    end

    it "rejects mismatched area and organization" do
      site = build(:site, organization: organization, area_of_operation: other_area)

      expect(site).not_to be_valid
      expect(site.errors[:area_of_operation_id]).to include("must belong to the same organization")
    end
  end
end
