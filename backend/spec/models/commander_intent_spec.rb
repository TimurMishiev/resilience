require "rails_helper"

RSpec.describe CommanderIntent, type: :model do
  it "requires one current intent per area of operation" do
    intent = create(:commander_intent)
    duplicate = build(:commander_intent, area_of_operation: intent.area_of_operation)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:area_of_operation_id]).to include("has already been taken")
  end

  it "requires the core intent fields" do
    intent = build(:commander_intent, title: nil, objective: nil, end_state: nil)

    expect(intent).not_to be_valid
    expect(intent.errors[:title]).to include("can't be blank")
    expect(intent.errors[:objective]).to include("can't be blank")
    expect(intent.errors[:end_state]).to include("can't be blank")
  end
end
