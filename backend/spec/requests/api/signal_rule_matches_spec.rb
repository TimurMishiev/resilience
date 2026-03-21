require "rails_helper"

RSpec.describe "Api::SignalRuleMatches", type: :request do
  let(:user) { create(:user) }

  let(:site_a)   { create(:site) }
  let(:site_b)   { create(:site) }
  let(:rule_a)   { create(:correlation_rule, name: "Rule A") }
  let(:rule_b)   { create(:correlation_rule, name: "Rule B") }

  let!(:match1) do
    create(:signal_rule_match,
           site: site_a, correlation_rule: rule_a,
           fired_at: 2.hours.ago)
  end
  let!(:match2) do
    create(:signal_rule_match,
           site: site_b, correlation_rule: rule_b,
           fired_at: 30.minutes.ago)
  end
  let!(:match3) do
    create(:signal_rule_match,
           site: site_a, correlation_rule: rule_b,
           fired_at: 10.minutes.ago)
  end

  describe "GET /api/signal_rule_matches" do
    it "returns 200 with data array and pagination meta" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns all matches ordered by fired_at desc" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["meta"]["total"]).to eq(3)
      times = body["data"].map { |m| m["fired_at"] }
      expect(times).to eq(times.sort.reverse)
    end

    it "returns expected fields on each record" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m.keys).to include("id", "fired_at", "metadata", "signal", "correlation_rule", "site", "task")
    end

    it "nests associated signal with key fields" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["signal"].keys).to include("id", "source", "signal_type", "lat", "lng")
    end

    it "nests associated correlation_rule with id and name" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["correlation_rule"].keys).to include("id", "name")
    end

    it "nests associated site with id and name" do
      get "/api/signal_rule_matches", headers: auth_headers(user)
      m = JSON.parse(response.body)["data"].first
      expect(m["site"].keys).to include("id", "name")
    end

    it "filters by rule_id" do
      get "/api/signal_rule_matches", params: { rule_id: rule_a.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id)
    end

    it "filters by site_id" do
      get "/api/signal_rule_matches", params: { site_id: site_a.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id, match3.id)
    end

    it "filters by from datetime" do
      from = 1.hour.ago.iso8601
      get "/api/signal_rule_matches", params: { from: from }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to include(match2.id, match3.id)
      expect(ids).not_to include(match1.id)
    end

    it "filters by to datetime" do
      to = 1.hour.ago.iso8601
      get "/api/signal_rule_matches", params: { to: to }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |m| m["id"] }
      expect(ids).to contain_exactly(match1.id)
    end

    it "requires authentication" do
      get "/api/signal_rule_matches"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/signal_rule_matches/:id" do
    it "returns 200 with the match and associations" do
      get "/api/signal_rule_matches/#{match1.id}", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(match1.id)
      expect(body["correlation_rule"]["name"]).to eq("Rule A")
      expect(body["site"]["id"]).to eq(site_a.id)
    end

    it "returns 404 for unknown UUID" do
      get "/api/signal_rule_matches/#{SecureRandom.uuid}", headers: auth_headers(user)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/signal_rule_matches/bulk_transition" do
    it "transitions all supplied matches to the requested status" do
      post "/api/signal_rule_matches/bulk_transition",
           params:  { ids: [match1.id, match2.id], to_status: "acknowledged" },
           headers: auth_headers(user), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["succeeded"].map { |r| r["id"] }).to contain_exactly(match1.id, match2.id)
      expect(body["failed"]).to be_empty
    end

    it "reports per-alert failures without aborting the batch" do
      # Close match1 so it cannot be re-acknowledged (invalid transition)
      match1.update_column(:workflow_status, "closed")

      post "/api/signal_rule_matches/bulk_transition",
           params:  { ids: [match1.id, match2.id], to_status: "acknowledged" },
           headers: auth_headers(user), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["succeeded"].map { |r| r["id"] }).to contain_exactly(match2.id)
      expect(body["failed"].map { |r| r["id"] }).to contain_exactly(match1.id)
    end

    it "returns 422 when ids or to_status is missing" do
      post "/api/signal_rule_matches/bulk_transition",
           params:  { to_status: "acknowledged" },
           headers: auth_headers(user), as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "returns 401 for unauthenticated requests" do
      post "/api/signal_rule_matches/bulk_transition",
           params: { ids: [match1.id], to_status: "acknowledged" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
