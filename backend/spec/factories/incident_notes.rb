FactoryBot.define do
  factory :incident_note do
    association :incident
    association :author, factory: :user
    sequence(:body) { |n| "Operator note #{n}: situation developing." }
  end
end
