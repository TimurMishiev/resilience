FactoryBot.define do
  factory :vessel_track do
    association :vessel
    lat         { 25.0 }
    lng         { 56.0 }
    speed       { 12.0 }
    heading     { 180 }
    occurred_at { 1.hour.ago }
  end
end
