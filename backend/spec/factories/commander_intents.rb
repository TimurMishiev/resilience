FactoryBot.define do
  factory :commander_intent do
    association :area_of_operation
    association :created_by, factory: [:user, :commander]
    association :updated_by, factory: [:user, :commander]
    sequence(:title) { |n| "Intent #{n}" }
    objective { "Secure the maritime corridor and preserve persistent sensing." }
    end_state { "Friendly assets hold continuous awareness over the AO without coverage gaps." }
    constraints { "Avoid collateral escalation near civilian shipping lanes." }
  end
end
