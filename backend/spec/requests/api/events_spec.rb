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
    it "treats a closed queue as terminal before attempting to parse JSON" do
      queue.close

      get "/api/events", params: { token: sse_token }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("event: connected")
      expect(response.body).not_to include("event: heartbeat")
      expect(broadcaster).to have_received(:unsubscribe).with(queue)
    end
  end
end
