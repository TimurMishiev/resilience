FactoryBot.define do
  factory :correlation_rule do
    sequence(:name) { |n| "Rule #{n}" }
    description      { "Test correlation rule" }
    is_active        { true }
    cooldown_minutes { 60 }
    conditions       { { "signal_type" => "seismic_event", "proximity_km" => 100 } }
    actions          { { "create_task" => { "title" => "Alert near {{site_name}}", "priority" => "high" } } }
    association      :created_by, factory: :user, role: "commander"

    trait :inactive do
      is_active { false }
    end

    trait :on_cooldown do
      last_fired_at    { 5.minutes.ago }
      cooldown_minutes { 60 }
    end

    trait :no_cooldown do
      last_fired_at    { nil }
      cooldown_minutes { 0 }
    end

    trait :wildfire do
      conditions { { "signal_type" => "wildfire", "proximity_km" => 50, "magnitude_min" => 100 } }
    end

    trait :with_count_threshold do
      conditions do
        {
          "signal_type"          => "seismic_event",
          "proximity_km"         => 100,
          "count_threshold"      => 3,
          "time_window_minutes"  => 60
        }
      end
    end
  end
end
