FactoryBot.define do
  factory :area_of_operation do
    sequence(:name) { |n| "AO #{n}" }
    threat_level { "green" }
    color        { "#23d160" }
    geometry     { { "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }
    association  :created_by, factory: :user, role: "commander"
  end
end
