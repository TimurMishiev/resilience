require "rails_helper"

RSpec.describe "Api::Recommendations", type: :request do
  include ActiveSupport::Testing::TimeHelpers

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

    it "reconstructs recommendation status at as_of for replay queries" do
      replay_target = create(:recommendation, status: "pending", expires_at: 4.hours.from_now)
      replay_target.update_columns(created_at: 2.hours.ago, updated_at: 2.hours.ago)

      travel_to 30.minutes.ago do
        replay_target.accept!(user: commander, reason: "Accepted then")
      end
      replay_target.update!(status: "executed", executed_at: 5.minutes.ago)

      get "/api/recommendations",
          params: {
            as_of: 20.minutes.ago.iso8601,
            affected_entity_id: replay_target.affected_entity_id,
            status: "accepted",
          },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = json
      expect(body["data"].map { |rec| rec["id"] }).to contain_exactly(replay_target.id)
      expect(body["data"].first["status"]).to eq("accepted")
      expect(body["data"].first["executed_at"]).to be_nil
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

    it "writes a recommendation_accepted audit event" do
      expect {
        post "/api/recommendations/#{rec.id}/accept",
             params:  { reason: "Looks right" },
             headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)
      expect(AuditEvent.last.event_type).to eq("recommendation_accepted")
      expect(AuditEvent.last.actor).to eq(commander.email)
    end

    it "returns 422 for already-reviewed rec" do
      rec.update!(status: "accepted")
      post "/api/recommendations/#{rec.id}/accept", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
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

    it "writes a recommendation_rejected audit event" do
      expect {
        post "/api/recommendations/#{rec.id}/reject", headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)
      expect(AuditEvent.last.event_type).to eq("recommendation_rejected")
    end
  end

  describe "POST /api/recommendations/:id/defer" do
    let!(:rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }

    it "transitions to deferred" do
      post "/api/recommendations/#{rec.id}/defer", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json["status"]).to eq "deferred"
    end

    it "writes a recommendation_deferred audit event" do
      expect {
        post "/api/recommendations/#{rec.id}/defer", headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)
      expect(AuditEvent.last.event_type).to eq("recommendation_deferred")
    end
  end

  describe "POST /api/recommendations/:id/execute" do
    let!(:rec) { create(:recommendation, status: "pending", expires_at: 2.hours.from_now) }

    it "accepts and executes a pending recommendation" do
      allow(Recommendations::ExecutorService).to receive(:call) do |args|
        args[:recommendation].mark_executed!
        ServiceResult.success
      end
      post "/api/recommendations/#{rec.id}/execute", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(json["status"]).to eq "executed"
    end

    it "returns 422 for a non-pending/accepted recommendation" do
      rec.update!(status: "rejected")
      post "/api/recommendations/#{rec.id}/execute", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rolls back accept! when ExecutorService fails — rec stays pending" do
      allow(Recommendations::ExecutorService).to receive(:call)
        .and_return(ServiceResult.failure(errors: ["dispatch error"]))
      post "/api/recommendations/#{rec.id}/execute", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      expect(rec.reload.status).to eq "pending"
    end

    it "forbids operator" do
      post "/api/recommendations/#{rec.id}/execute", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
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
