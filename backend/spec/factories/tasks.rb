FactoryBot.define do
  factory :task do
    association :site
    title           { Faker::Lorem.sentence(word_count: 4).chomp(".") }
    description     { Faker::Lorem.paragraph }
    priority        { "normal" }
    workflow_status { "new" }
    blocked_reason  { nil }
    resolved_at     { nil }

    trait :triaged do
      workflow_status { "triaged" }
    end

    trait :in_progress do
      workflow_status { "in_progress" }
    end

    trait :blocked do
      workflow_status { "blocked" }
      blocked_reason  { Faker::Lorem.sentence }
    end

    trait :resolved do
      workflow_status { "resolved" }
      resolved_at     { Time.current }
    end

    trait :high_priority do
      priority { "high" }
    end

    trait :critical do
      priority { "critical" }
    end

    trait :with_asset do
      association :asset
    end
  end
end
