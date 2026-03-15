FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@resilience.test" }
    password { "password123" }
    role     { "operator" }

    trait :commander do
      role { "commander" }
    end
  end
end
