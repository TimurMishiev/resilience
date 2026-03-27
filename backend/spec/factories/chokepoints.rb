FactoryBot.define do
  factory :chokepoint do
    association :area_of_operation
    association :created_by, factory: [:user, :commander]
    association :updated_by, factory: [:user, :commander]
    sequence(:name) { |n| "Strait Node #{n}" }
    category { "strait" }
    status { "monitor" }
    latitude { 25.285447 }
    longitude { 56.334457 }
    watch_radius_km { 24.5 }
    notes { "Primary maritime constriction for monitored lane traffic." }
  end
end
