FactoryBot.define do
  factory :vessel do
    sequence(:mmsi) { |n| "#{700_000_000 + n}" }
    name            { "MV TEST VESSEL" }
    vessel_type     { "cargo" }
    flag            { "US" }
    lat             { 25.0 }
    lng             { 56.0 }
    speed           { 12.0 }
    heading         { 180 }
    first_seen_at   { 2.hours.ago }
    last_seen_at    { 5.minutes.ago }

    trait :dark do
      last_seen_at { 30.minutes.ago }
    end

    trait :loitering do
      speed           { 1.0 }
      loitering_since { 20.minutes.ago }
    end
  end
end
