FactoryBot.define do
  factory :telemetry_reading do
    association :asset
    lat { 37.7749 }
    lng { -122.4194 }
    speed { 5.5 }
    heading { 90.0 }
    battery { 82.0 }
    occurred_at { Time.current }
    created_at { occurred_at }
  end
end
