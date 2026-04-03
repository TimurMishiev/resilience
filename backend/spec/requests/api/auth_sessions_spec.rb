require "rails_helper"

RSpec.describe "Api::Auth::Sessions", type: :request do
  let(:user) { create(:user, email: "commander@resilience.test", password: "password123", role: "commander") }
  let(:admin) { create(:user, :admin, email: "admin@resilience.test", password: "password123") }

  before do
    RevokedJwt.delete_all
    UserSession.delete_all if defined?(UserSession) && UserSession.table_exists?
  end

  after do
    RevokedJwt.delete_all
    UserSession.delete_all if defined?(UserSession) && UserSession.table_exists?
  end

  describe "POST /api/auth/login" do
    it "sets an authenticated session cookie for valid credentials" do
      post "/api/auth/login", params: { session: { email: user.email, password: "password123" } }

      expect(response).to have_http_status(:created)
      expect(response.cookies["_resilience_session"]).to be_present
      expect(JSON.parse(response.body)).to include("user" => include("email" => user.email, "role" => "commander"))
      expect(UserSession.where(user: user).count).to eq(1)
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

    it "revokes all sessions for the current user when all_sessions=true" do
      current_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      current_payload = JwtAuthenticatable.decode_payload(current_token)
      current_session = UserSession.issue!(user: user, token_payload: current_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      other_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      other_payload = JwtAuthenticatable.decode_payload(other_token)
      other_session = UserSession.issue!(user: user, token_payload: other_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.2"))

      delete "/api/auth/logout", params: { all_sessions: true }, headers: { "Authorization" => "Bearer #{current_token}" }

      expect(response).to have_http_status(:no_content)
      expect(current_session.reload.revoked_at).to be_present
      expect(other_session.reload.revoked_at).to be_present
      expect(user.reload.tokens_valid_after).to be_present
    end
  end

  describe "GET /api/auth/sessions" do
    it "lists the current user's sessions and marks the current session" do
      current_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      current_payload = JwtAuthenticatable.decode_payload(current_token)
      current_session = UserSession.issue!(user: user, token_payload: current_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      other_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      other_payload = JwtAuthenticatable.decode_payload(other_token)
      UserSession.issue!(user: user, token_payload: other_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.2"))

      get "/api/auth/sessions", headers: { "Authorization" => "Bearer #{current_token}" }

      expect(response).to have_http_status(:ok)
      data = JSON.parse(response.body).fetch("data")
      expect(data.size).to eq(2)
      expect(data.find { |row| row.fetch("id") == current_session.id }.fetch("current")).to eq(true)
    end

    it "allows admins to inspect another user's sessions" do
      target_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      target_payload = JwtAuthenticatable.decode_payload(target_token)
      UserSession.issue!(user: user, token_payload: target_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      admin_token = JwtAuthenticatable.encode(sub: admin.id, email: admin.email, role: admin.role)
      get "/api/auth/sessions", params: { user_email: user.email }, headers: { "Authorization" => "Bearer #{admin_token}" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("meta", "user_email")).to eq(user.email)
    end

    it "forbids non-admin users from inspecting another user's sessions" do
      token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)

      get "/api/auth/sessions", params: { user_email: "other@resilience.test" }, headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "DELETE /api/auth/sessions/:id" do
    it "revokes a selected session for the current user" do
      current_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      current_payload = JwtAuthenticatable.decode_payload(current_token)
      UserSession.issue!(user: user, token_payload: current_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      other_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      other_payload = JwtAuthenticatable.decode_payload(other_token)
      other_session = UserSession.issue!(user: user, token_payload: other_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.2"))

      delete "/api/auth/sessions/#{other_session.id}", headers: { "Authorization" => "Bearer #{current_token}" }

      expect(response).to have_http_status(:no_content)
      expect(other_session.reload.revoked_at).to be_present
    end
  end

  describe "DELETE /api/auth/sessions" do
    it "revokes all other sessions while keeping the current one when keep_current=true" do
      current_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      current_payload = JwtAuthenticatable.decode_payload(current_token)
      current_session = UserSession.issue!(user: user, token_payload: current_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      other_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      other_payload = JwtAuthenticatable.decode_payload(other_token)
      other_session = UserSession.issue!(user: user, token_payload: other_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.2"))

      delete "/api/auth/sessions",
             params: { all: true, keep_current: true },
             headers: { "Authorization" => "Bearer #{current_token}" }

      expect(response).to have_http_status(:no_content)
      expect(current_session.reload.revoked_at).to be_nil
      expect(other_session.reload.revoked_at).to be_present
      expect(user.reload.tokens_valid_after).to be_nil
    end

    it "allows admins to revoke every session for another user" do
      admin_token = JwtAuthenticatable.encode(sub: admin.id, email: admin.email, role: admin.role)

      current_token = JwtAuthenticatable.encode(sub: user.id, email: user.email, role: user.role)
      current_payload = JwtAuthenticatable.decode_payload(current_token)
      current_session = UserSession.issue!(user: user, token_payload: current_payload, request: instance_double(ActionDispatch::Request, user_agent: "RSpec", remote_ip: "127.0.0.1"))

      delete "/api/auth/sessions",
             params: { all: true, user_email: user.email },
             headers: { "Authorization" => "Bearer #{admin_token}" }

      expect(response).to have_http_status(:no_content)
      expect(current_session.reload.revoked_at).to be_present
      expect(user.reload.tokens_valid_after).to be_present
    end
  end
end
