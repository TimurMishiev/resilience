FactoryBot.define do
  factory :operational_status do
    category { "feed_health" }
    sequence(:key) { |n| "feed_#{n}" }
    payload  { { feed: "test", status: "ok", last_poll: Time.current.iso8601 } }
  end
end
