module AuthHelpers
  # Returns an Authorization header hash for the given user.
  # Creates a commander by default if no user is supplied.
  def auth_headers(user = nil)
    user ||= FactoryBot.create(:user, :commander)
    token = JwtAuthenticatable.encode(sub: user.id, role: user.role)
    { "Authorization" => "Bearer #{token}" }
  end
end

RSpec.configure do |config|
  config.include AuthHelpers, type: :request
end
