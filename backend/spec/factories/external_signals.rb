FactoryBot.define do
  factory :external_signal do
    sequence(:external_id) { |n| "signal-#{n}" }
    source      { "usgs_seismic" }
    signal_type { "seismic_event" }
    lat         { 51.5 }
    lng         { 0.0 }
    occurred_at { Time.current }
    raw_payload { { "mag" => 3.5, "place" => "Test location" } }

    trait :aircraft do
      source      { "opensky" }
      signal_type { "aircraft_position" }
      altitude    { 10_000 }
      speed       { 500 }
      heading     { 90 }
    end

    trait :wildfire do
      source      { "firms_wildfire" }
      signal_type { "wildfire" }
      magnitude   { 150.0 }
    end

    trait :gps_jamming do
      source      { "gpsjam" }
      signal_type { "gps_jamming" }
    end

    trait :vessel do
      source      { "ais" }
      signal_type { "vessel_position" }
      speed       { 12 }
      heading     { 180 }
    end
  end
end
