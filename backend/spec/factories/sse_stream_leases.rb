FactoryBot.define do
  factory :sse_stream_lease do
    association :user
    stream_name { "events" }
    remote_ip   { "127.0.0.1" }
    lease_key   { SecureRandom.uuid }
    expires_at  { 5.minutes.from_now }
  end
end
