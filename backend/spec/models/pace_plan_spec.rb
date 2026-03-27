require "rails_helper"

RSpec.describe PacePlan, type: :model do
  it "requires one current PACE plan per area of operation" do
    plan = create(:pace_plan)
    duplicate = build(:pace_plan, area_of_operation: plan.area_of_operation)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:area_of_operation_id]).to include("has already been taken")
  end

  it "requires all PACE paths" do
    plan = build(
      :pace_plan,
      primary_plan: nil,
      alternate_plan: nil,
      contingency_plan: nil,
      emergency_plan: nil
    )

    expect(plan).not_to be_valid
    expect(plan.errors[:primary_plan]).to include("can't be blank")
    expect(plan.errors[:alternate_plan]).to include("can't be blank")
    expect(plan.errors[:contingency_plan]).to include("can't be blank")
    expect(plan.errors[:emergency_plan]).to include("can't be blank")
  end
end
