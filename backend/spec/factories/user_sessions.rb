FactoryBot.define do
  factory :user_session do
    association :user
    jti { SecureRandom.uuid }
    user_agent { "RSpec Browser/1.0" }
    ip_address { "127.0.0.1" }
    last_seen_at { Time.current }
    expires_at { 24.hours.from_now }
    revoked_at { nil }
    revoke_reason { nil }
  end
end
