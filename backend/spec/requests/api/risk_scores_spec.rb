require "rails_helper"

RSpec.describe "Api::RiskScores", type: :request do
  let(:user)    { create(:user) }
  let!(:site_a) { create(:site, name: "Alpha", latitude: 11.5, longitude: 43.1) }
  let!(:site_b) { create(:site, name: "Bravo", latitude: 48.8, longitude: 2.3) }

  describe "GET /api/risk_scores" do
    it "requires authentication" do
      get "/api/risk_scores"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 200 for authenticated users" do
      get "/api/risk_scores", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
    end

    it "returns one entry per site" do
      get "/api/risk_scores", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body.length).to eq(2)
    end

    it "returns required fields for each site" do
      get "/api/risk_scores", headers: auth_headers(user)
      entry = JSON.parse(response.body).first
      expect(entry.keys).to include(
        "site_id", "site_name", "score", "risk_level", "components", "computed_at"
      )
    end

    it "returns component breakdown" do
      get "/api/risk_scores", headers: auth_headers(user)
      components = JSON.parse(response.body).first["components"]
      expect(components.keys).to include(
        "alert_pressure", "task_health", "signal_density"
      )
    end

    it "returns valid risk levels" do
      get "/api/risk_scores", headers: auth_headers(user)
      levels = JSON.parse(response.body).map { |r| r["risk_level"] }
      expect(levels).to all(be_in(%w[low moderate high critical]))
    end

    it "returns score 0 for a clean site with no alerts or tasks" do
      get "/api/risk_scores", headers: auth_headers(user)
      bravo = JSON.parse(response.body).find { |r| r["site_id"] == site_b.id }
      expect(bravo["score"]).to eq(0)
      expect(bravo["risk_level"]).to eq("low")
    end

    context "when a site has open high-confidence alerts" do
      before do
        rule  = create(:correlation_rule)
        signal = create(:external_signal)
        create(:signal_rule_match,
               site:            site_a,
               correlation_rule: rule,
               signal:          signal,
               confidence:      1.0,
               workflow_status: "unacknowledged",
               fired_at:        1.hour.ago)
      end

      it "reflects alert pressure in the score" do
        get "/api/risk_scores", headers: auth_headers(user)
        alpha = JSON.parse(response.body).find { |r| r["site_id"] == site_a.id }
        expect(alpha["components"]["alert_pressure"]).to be > 0
        expect(alpha["score"]).to be > 0
      end
    end
  end
end
