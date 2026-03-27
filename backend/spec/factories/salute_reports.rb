FactoryBot.define do
  factory :salute_report do
    association :area_of_operation
    association :created_by, factory: [:user, :commander]
    site { nil }
    size { "3 small craft" }
    activity { "Loitering near the outer patrol boundary." }
    location { "Grid 42R BT 12000 88000" }
    unit { "Unknown irregular maritime element" }
    observed_at { Time.zone.parse("2026-03-27T09:30:00Z") }
    equipment { "Outboard engines and portable radios" }
    remarks { "Pattern suggests route reconnaissance rather than transit." }
  end
end
