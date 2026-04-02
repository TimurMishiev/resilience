require "rails_helper"

RSpec.describe "Api::Auth::Sessions", type: :request do
  let(:user) { create(:user, email: "commander@resilience.test", password: "password123", role: "commander") }

  before do
    RevokedJwt.delete_all
  end

  after do
    RevokedJwt.delete_all
  end

  describe "POST /api/auth/login" do
    it "sets an authenticated session cookie for valid credentials" do
      post "/api/auth/login", params: { session: { email: user.email, password: "password123" } }

      expect(response).to have_http_status(:created)
      expect(response.cookies["_resilience_session"]).to be_present
      expect(JSON.parse(response.body)).to include("user" => include("email" => user.email, "role" => "commander"))
    end
  end

  describe "DELETE /api/auth/logout" do
    it "revokes the current token so it can no longer authenticate" do
      token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)

      delete "/api/auth/logout", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:no_content)
      expect(RevokedJwt.active.count).to eq(1)

      get "/api/sites", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)["errors"]).to include("Token revoked")
    end
  end
end
