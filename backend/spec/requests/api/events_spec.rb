require "rails_helper"

RSpec.describe "Api::Events", type: :request do
  let(:user) { create(:user) }
  let(:sse_token) { JwtAuthenticatable.encode_sse(user.id) }
  let(:queue) { Queue.new }
  let(:broadcaster) { instance_double(Sse::Broadcaster, subscribe: queue, unsubscribe: nil) }

  before do
    allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
  end

  describe "GET /api/events" do
    around do |example|
      original_user_limit = ENV["SSE_MAX_STREAMS_PER_USER"]

      ENV["SSE_MAX_STREAMS_PER_USER"] = "1"
      example.run
    ensure
      original_user_limit ? ENV["SSE_MAX_STREAMS_PER_USER"] = original_user_limit : ENV.delete("SSE_MAX_STREAMS_PER_USER")
    end

    it "treats a closed queue as terminal before attempting to parse JSON" do
      queue.close

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("event: connected")
      expect(response.body).not_to include("event: heartbeat")
      expect(broadcaster).to have_received(:unsubscribe).with(queue)
    end

    it "returns 429 when the user already has too many live streams" do
      SseStreamLease.create!(
        user: user,
        stream_name: "telemetry",
        remote_ip: "127.0.0.1",
        lease_key: SecureRandom.uuid,
        expires_at: 5.minutes.from_now,
      )

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body).fetch("errors").first).to match(/Too many live streams/)
    end

    it "rate limits repeated stream opens from the same IP" do
      queue.close

      Rack::Attack::SSE_STREAM_OPENS_PER_MINUTE.times do
        get "/api/events", params: { token: sse_token }
        expect(response).to have_http_status(:ok)
      end

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:too_many_requests)
      expect(response.headers["Retry-After"]).to be_present
    end
  end
end
