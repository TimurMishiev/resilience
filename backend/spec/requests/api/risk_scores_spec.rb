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
      data = JSON.parse(response.body)["data"]
      expect(data.length).to eq(2)
    end

    it "returns required fields for each site" do
      get "/api/risk_scores", headers: auth_headers(user)
      entry = JSON.parse(response.body)["data"].first
      expect(entry.keys).to include(
        "site_id", "site_name", "score", "risk_level", "components", "computed_at"
      )
    end

    it "returns component breakdown" do
      get "/api/risk_scores", headers: auth_headers(user)
      components = JSON.parse(response.body)["data"].first["components"]
      expect(components.keys).to include(
        "alert_pressure", "task_health", "signal_density"
      )
    end

    it "returns valid risk levels" do
      get "/api/risk_scores", headers: auth_headers(user)
      levels = JSON.parse(response.body)["data"].map { |r| r["risk_level"] }
      expect(levels).to all(be_in(%w[low moderate high critical]))
    end

    it "returns score 0 for a clean site with no alerts or tasks" do
      get "/api/risk_scores", headers: auth_headers(user)
      bravo = JSON.parse(response.body)["data"].find { |r| r["site_id"] == site_b.id }
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
        alpha = JSON.parse(response.body)["data"].find { |r| r["site_id"] == site_a.id }
        expect(alpha["components"]["alert_pressure"]).to be > 0
        expect(alpha["score"]).to be > 0
      end
    end

    context "replay via as_of" do
      let(:cutoff)  { 1.hour.ago.change(usec: 0) }

      before do
        site_a.update_columns(created_at: 1.day.ago, updated_at: 1.day.ago)
        site_b.update_columns(created_at: 1.day.ago, updated_at: 1.day.ago)
      end
      let!(:snap_a) do
        create(:site_risk_snapshot,
               site: site_a,
               score: 72,
               risk_level: "high",
               alert_pressure: 30.0,
               task_health: 22.0,
               signal_density: 20.0,
               recorded_at: cutoff - 30.minutes)
      end
      let!(:snap_b) do
        create(:site_risk_snapshot,
               site: site_b,
               score: 10,
               risk_level: "low",
               alert_pressure: 5.0,
               task_health: 3.0,
               signal_density: 2.0,
               recorded_at: cutoff - 30.minutes)
      end
      # A future snapshot that should be excluded
      let!(:snap_future) do
        create(:site_risk_snapshot,
               site: site_a,
               score: 90,
               risk_level: "critical",
               alert_pressure: 40.0,
               task_health: 30.0,
               signal_density: 20.0,
               recorded_at: cutoff + 30.minutes)
      end

      it "returns historical snapshots at the cutoff" do
        get "/api/risk_scores", params: { as_of: cutoff.iso8601 }, headers: auth_headers(user)
        expect(response).to have_http_status(:ok)
        data = JSON.parse(response.body)["data"]

        alpha = data.find { |r| r["site_id"] == site_a.id }
        expect(alpha["score"]).to eq(72)
        expect(alpha["risk_level"]).to eq("high")
        expect(alpha["components"]["alert_pressure"]).to eq(30.0)
        expect(alpha["as_of"]).to be_present
      end

      it "excludes snapshots recorded after the cutoff" do
        get "/api/risk_scores", params: { as_of: cutoff.iso8601 }, headers: auth_headers(user)
        data = JSON.parse(response.body)["data"]
        alpha = data.find { |r| r["site_id"] == site_a.id }
        expect(alpha["score"]).to eq(72) # not 90 from future snapshot
      end

      it "returns the latest snapshot per site when multiple exist" do
        create(:site_risk_snapshot,
               site: site_a,
               score: 50,
               risk_level: "moderate",
               alert_pressure: 20.0,
               task_health: 15.0,
               signal_density: 15.0,
               recorded_at: cutoff - 2.hours)

        get "/api/risk_scores", params: { as_of: cutoff.iso8601 }, headers: auth_headers(user)
        data = JSON.parse(response.body)["data"]
        alpha = data.find { |r| r["site_id"] == site_a.id }
        expect(alpha["score"]).to eq(72) # latest before cutoff, not older
      end
    end
  end
end
