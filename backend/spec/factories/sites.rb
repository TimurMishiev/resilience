FactoryBot.define do
  factory :site do
    name        { "Site #{Faker::Alphanumeric.alpha(number: 6).upcase}" }
    latitude    { Faker::Address.latitude }
    longitude   { Faker::Address.longitude }
    status      { "active" }

    trait :inactive do
      status { "inactive" }
    end
  end
end
