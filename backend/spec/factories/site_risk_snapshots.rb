FactoryBot.define do
  factory :site_risk_snapshot do
    association :site
    score          { rand(10..80) }
    risk_level     { "moderate" }
    alert_pressure { 12.5 }
    task_health    { 10.0 }
    signal_density { 8.0  }
    recorded_at    { 2.hours.ago }
  end
end
