require "rails_helper"

RSpec.describe "Api::SseTokens", type: :request do
  let(:user) { create(:user) }

  describe "POST /api/sse_token" do
    it "requires authentication" do
      post "/api/sse_token"

      expect(response).to have_http_status(:unauthorized)
    end

    it "issues a short-lived token for EventSource auth" do
      post "/api/sse_token", headers: auth_headers(user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("token")).to be_present
      expect(body.fetch("expires_in")).to eq(JwtAuthenticatable::SSE_TTL.to_i)
    end

    it "rate limits token minting bursts from the same IP" do
      Rack::Attack::SSE_TOKEN_REQUESTS_PER_MINUTE.times do
        post "/api/sse_token", headers: auth_headers(user)
        expect(response).to have_http_status(:ok)
      end

      post "/api/sse_token", headers: auth_headers(user)

      expect(response).to have_http_status(:too_many_requests)
      expect(response.headers["Retry-After"]).to be_present
      expect(JSON.parse(response.body).fetch("errors").first).to match(/Rate limit exceeded/)
    end
  end
end
