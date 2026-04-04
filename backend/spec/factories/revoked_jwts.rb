FactoryBot.define do
  factory :revoked_jwt do
    jti        { SecureRandom.uuid }
    expires_at { 24.hours.from_now }
  end
end
