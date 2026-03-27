require "rails_helper"

RSpec.describe Chokepoint, type: :model do
  it "requires a unique name per area of operation" do
    chokepoint = create(:chokepoint, name: "Hormuz East")
    duplicate = build(:chokepoint, area_of_operation: chokepoint.area_of_operation, name: "Hormuz East")

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:name]).to include("has already been taken")
  end

  it "enforces case-insensitive uniqueness at the database layer" do
    chokepoint = create(:chokepoint, name: "Hormuz East")
    duplicate = build(:chokepoint, area_of_operation: chokepoint.area_of_operation, name: "hormuz east")

    expect { duplicate.save!(validate: false) }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "validates category, status, and watch radius bounds" do
    chokepoint = build(:chokepoint, category: "unknown", status: "bad", watch_radius_km: 0)

    expect(chokepoint).not_to be_valid
    expect(chokepoint.errors[:category]).to include("is not included in the list")
    expect(chokepoint.errors[:status]).to include("is not included in the list")
    expect(chokepoint.errors[:watch_radius_km]).to be_present
  end

  it "validates latitude and longitude bounds" do
    chokepoint = build(:chokepoint, latitude: 91, longitude: -181)

    expect(chokepoint).not_to be_valid
    expect(chokepoint.errors[:latitude]).to be_present
    expect(chokepoint.errors[:longitude]).to be_present
  end
end
