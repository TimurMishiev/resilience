require "rails_helper"

RSpec.describe SaluteReport, type: :model do
  it "requires activity, location, and observed_at" do
    report = build(:salute_report, activity: nil, location: nil, observed_at: nil)

    expect(report).not_to be_valid
    expect(report.errors[:activity]).to include("can't be blank")
    expect(report.errors[:location]).to include("can't be blank")
    expect(report.errors[:observed_at]).to include("can't be blank")
  end

  it "rejects sites outside the selected area of operation" do
    ao = create(:area_of_operation)
    other_ao = create(:area_of_operation)
    site = create(:site, area_of_operation: other_ao)
    report = build(:salute_report, area_of_operation: ao, site: site)

    expect(report).not_to be_valid
    expect(report.errors[:site_id]).to include("must belong to the selected area of operation")
  end
end
