FactoryBot.define do
  factory :incident do
    association :site
    sequence(:title) { |n| "Incident #{n}" }
    status      { "open" }
    severity    { "moderate" }
    confidence  { 0.6 }
    opened_at   { Time.current }

    trait :critical do
      severity   { "critical" }
      confidence { 0.9 }
    end

    trait :acknowledged do
      status          { "acknowledged" }
      acknowledged_at { Time.current }
    end

    trait :closed do
      status     { "closed" }
      closed_at  { Time.current }
    end

    trait :assigned do
      association :assigned_to, factory: :user
      assigned_at { Time.current }
    end
  end
end
