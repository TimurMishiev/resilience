require "rails_helper"

RSpec.describe "Api::Recommendations", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }

  describe "GET /api/recommendations" do
    let!(:pending_rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }
    let!(:expired_rec) { create(:recommendation, status: "pending", expires_at: 1.hour.ago) }
    let!(:rejected_rec) { create(:recommendation, :rejected) }

    it "returns only active (pending + not expired) recommendations by default" do
      get "/api/recommendations", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      ids = json["data"].map { |r| r["id"] }
      expect(ids).to include(pending_rec.id)
      expect(ids).not_to include(expired_rec.id)
      expect(ids).not_to include(rejected_rec.id)
    end

    it "returns all statuses when status param is provided" do
      get "/api/recommendations?status=rejected", headers: auth_headers(operator)
      ids = json["data"].map { |r| r["id"] }
      expect(ids).to include(rejected_rec.id)
    end

    it "requires authentication" do
      get "/api/recommendations"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/recommendations/generate" do
    it "allows commander to trigger generation" do
      post "/api/recommendations/generate", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json).to have_key("created")
    end

    it "forbids non-commander" do
      post "/api/recommendations/generate", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/recommendations/:id/accept" do
    let!(:rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }

    it "transitions to accepted" do
      post "/api/recommendations/#{rec.id}/accept",
           params:  { reason: "Looks right" },
           headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json["status"]).to eq "accepted"
      expect(json["review_reason"]).to eq "Looks right"
    end

    it "returns 422 for already-reviewed rec" do
      rec.update!(status: "accepted")
      post "/api/recommendations/#{rec.id}/accept", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "forbids operator" do
      post "/api/recommendations/#{rec.id}/accept", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/recommendations/:id/reject" do
    let!(:rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }

    it "transitions to rejected" do
      post "/api/recommendations/#{rec.id}/reject",
           params:  { reason: "False positive" },
           headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json["status"]).to eq "rejected"
    end
  end

  describe "POST /api/recommendations/:id/defer" do
    let!(:rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }

    it "transitions to deferred" do
      post "/api/recommendations/#{rec.id}/defer", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json["status"]).to eq "deferred"
    end
  end

  describe "GET /api/recommendations/metrics" do
    before do
      create(:recommendation, status: "accepted")
      create(:recommendation, status: "rejected")
      create(:recommendation, :llm, status: "pending", expires_at: 2.hours.from_now)
    end

    it "returns aggregate metrics" do
      get "/api/recommendations/metrics", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(json.keys).to include("pending", "accepted", "rejected", "executed", "expired", "by_tier", "by_type")
      expect(json["accepted"]).to eq 1
      expect(json["rejected"]).to eq 1
    end
  end

  private

  def json
    JSON.parse(response.body)
  end
end
