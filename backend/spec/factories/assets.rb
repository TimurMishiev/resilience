FactoryBot.define do
  factory :asset do
    name        { Faker::Vehicle.make_and_model }
    asset_type  { Asset::ASSET_TYPES.sample }
    status      { "available" }
    home_site   { nil }

    trait :in_use do
      status { "in_use" }
    end

    trait :offline do
      status { "offline" }
    end

    trait :with_home_site do
      association :home_site, factory: :site
    end
  end
end
