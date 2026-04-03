FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@resilience.test" }
    password { "password123" }
    role     { "operator" }

    trait :commander do
      role { "commander" }
    end

    trait :operator do
      role { "operator" }
    end

    trait :viewer do
      role { "viewer" }
    end

    trait :admin do
      role { "admin" }
    end
  end
end
