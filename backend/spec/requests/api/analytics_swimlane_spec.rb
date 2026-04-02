require "rails_helper"

RSpec.describe "Api::Analytics#swimlane", type: :request do
  let(:current_user) { create(:user, :commander) }
  let(:operator)     { create(:user, :operator) }
  let!(:alpha)       { create(:site, name: "Alpha", latitude: 26.5, longitude: 56.2) }
  let!(:bravo)       { create(:site, name: "Bravo", latitude: 25.0, longitude: 55.0) }
  let!(:charlie)     { create(:site, :inactive, name: "Charlie", latitude: 24.0, longitude: 54.0) }

  describe "GET /api/analytics/throughput" do
    it "requires authentication" do
      get "/api/analytics/throughput"

      expect(response).to have_http_status(:unauthorized)
    end

    it "returns throughput data for operators" do
      get "/api/analytics/throughput", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"]).to be_an(Array)
    end
  end

  describe "GET /api/analytics/swimlane" do
    it "returns lanes and meta for active sites with recent events" do
      create(:task, site: alpha, title: "Inspect pier", created_at: 20.minutes.ago)
      create(:signal_rule_match, :without_task, site: bravo, fired_at: 90.minutes.ago)

      get "/api/analytics/swimlane", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)

      expect(body["meta"]).to include(
        "days" => 3,
        "lane_limit" => 8,
        "lane_count" => 2
      )
      expect(body["data"].map { |lane| lane["site_id"] }).to eq([alpha.id, bravo.id])
      expect(body["data"].map { |lane| lane["site_id"] }).not_to include(charlie.id)
    end

    it "filters lanes by event kind" do
      create(:task, site: alpha, title: "Inspect pier", created_at: 20.minutes.ago)
      create(:signal_rule_match, :without_task, site: bravo, fired_at: 90.minutes.ago)

      get "/api/analytics/swimlane",
          params: { kinds: ["rule_fired"] },
          headers: auth_headers(current_user)

      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(1)
      expect(body["data"].first["site_id"]).to eq(bravo.id)
      expect(body["data"].first["events"].map { |event| event["event_kind"] }.uniq).to eq(["rule_fired"])
    end

    it "respects lane_limit" do
      create(:task, site: alpha, title: "Inspect pier", created_at: 20.minutes.ago)
      create(:signal_rule_match, :without_task, site: bravo, fired_at: 90.minutes.ago)

      get "/api/analytics/swimlane",
          params: { lane_limit: 1 },
          headers: auth_headers(current_user)

      body = JSON.parse(response.body)
      expect(body["meta"]["lane_limit"]).to eq(1)
      expect(body["data"].size).to eq(1)
      expect(body["data"].first["site_id"]).to eq(alpha.id)
    end

    it "respects the days parameter" do
      create(:task, site: alpha, title: "Recent task", created_at: 2.days.ago)
      create(:task, site: bravo, title: "Older task", created_at: 10.days.ago)

      get "/api/analytics/swimlane",
          params: { days: 3 },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meta"]["days"]).to eq(3)
      expect(body["data"].map { |lane| lane["site_id"] }).to eq([alpha.id])
      expect(body["data"].first["events"].map { |event| event["title"] }).to include("Task created: Recent task")
    end

    it "filters lanes by site_ids" do
      create(:task, site: alpha, title: "Inspect pier", created_at: 20.minutes.ago)
      create(:signal_rule_match, :without_task, site: bravo, fired_at: 90.minutes.ago)

      get "/api/analytics/swimlane",
          params: { site_ids: [bravo.id] },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meta"]["selected_site_ids"]).to eq([bravo.id])
      expect(body["data"].size).to eq(1)
      expect(body["data"].first["site_id"]).to eq(bravo.id)
    end

    it "returns 401 without authentication" do
      get "/api/analytics/swimlane"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns lanes for operators as well as commanders" do
      get "/api/analytics/swimlane", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("data", "meta")
    end
  end
end
