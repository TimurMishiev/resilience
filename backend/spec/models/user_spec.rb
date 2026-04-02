require "rails_helper"

RSpec.describe User, type: :model do
  describe "role predicates" do
    it "viewer? is true only for viewer role" do
      expect(build(:user, :viewer).viewer?).to be true
      expect(build(:user, :operator).viewer?).to be false
      expect(build(:user, :commander).viewer?).to be false
    end

    it "operator? is true only for operator role" do
      expect(build(:user, :operator).operator?).to be true
      expect(build(:user, :viewer).operator?).to be false
    end

    it "commander? is true only for commander role" do
      expect(build(:user, :commander).commander?).to be true
      expect(build(:user, :operator).commander?).to be false
    end

    it "operator_or_above? is true for operator and commander" do
      expect(build(:user, :operator).operator_or_above?).to be true
      expect(build(:user, :commander).operator_or_above?).to be true
      expect(build(:user, :viewer).operator_or_above?).to be false
    end
  end

  describe "role validation" do
    it "accepts viewer, operator, commander" do
      %w[viewer operator commander].each do |role|
        expect(build(:user, role: role)).to be_valid
      end
    end

    it "rejects unknown roles" do
      expect(build(:user, role: "superadmin")).not_to be_valid
    end
  end

  describe "AO scope" do
    let(:ao) { create(:area_of_operation) }

    it "accepts a user scoped to an AO" do
      user = build(:user, area_of_operation: ao)
      expect(user).to be_valid
      expect(user.area_of_operation_id).to eq(ao.id)
    end

    it "accepts a user without an AO scope" do
      expect(build(:user)).to be_valid
    end
  end
end
