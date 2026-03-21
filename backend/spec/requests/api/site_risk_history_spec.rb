require "rails_helper"

RSpec.describe "Api::Sites#risk_history", type: :request do
  let(:current_user) { create(:user, :commander) }
  let(:site)         { create(:site) }

  describe "GET /api/sites/:id/risk_history" do
    context "with valid credentials" do
      it "returns 200" do
        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        expect(response).to have_http_status(:ok)
      end

      it "returns data array and meta" do
        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body).to have_key("data")
        expect(body).to have_key("meta")
        expect(body["data"]).to be_an(Array)
        expect(body["meta"]["site_id"]).to eq(site.id)
      end

      it "returns snapshots for this site in chronological order" do
        create(:site_risk_snapshot, site: site, recorded_at: 5.hours.ago, score: 30)
        create(:site_risk_snapshot, site: site, recorded_at: 3.hours.ago, score: 45)
        create(:site_risk_snapshot, site: site, recorded_at: 1.hour.ago,  score: 60)

        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        scores = JSON.parse(response.body)["data"].map { |s| s["score"] }
        expect(scores).to eq([30, 45, 60])
      end

      it "excludes snapshots for other sites" do
        other = create(:site)
        create(:site_risk_snapshot, site: other, recorded_at: 1.hour.ago)
        create(:site_risk_snapshot, site: site,  recorded_at: 1.hour.ago)

        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body["data"].size).to eq(1)
      end

      it "includes expected fields on each snapshot" do
        create(:site_risk_snapshot, site: site)
        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        snap = JSON.parse(response.body)["data"].first
        expect(snap.keys).to include(
          "id", "recorded_at", "score", "risk_level",
          "alert_pressure", "task_health", "signal_density"
        )
      end

      it "respects the days parameter" do
        create(:site_risk_snapshot, site: site, recorded_at: 10.days.ago)
        create(:site_risk_snapshot, site: site, recorded_at: 2.days.ago)

        get "/api/sites/#{site.id}/risk_history",
            params:  { days: 3 },
            headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body["data"].size).to eq(1)
        expect(body["meta"]["days"]).to eq(3)
      end

      it "clamps days to 30 maximum" do
        get "/api/sites/#{site.id}/risk_history",
            params:  { days: 999 },
            headers: auth_headers(current_user)
        expect(JSON.parse(response.body)["meta"]["days"]).to eq(30)
      end

      it "returns empty data when no snapshots exist" do
        get "/api/sites/#{site.id}/risk_history", headers: auth_headers(current_user)
        body = JSON.parse(response.body)
        expect(body["data"]).to be_empty
        expect(body["meta"]["total"]).to eq(0)
      end
    end

    context "without authentication" do
      it "returns 401" do
        get "/api/sites/#{site.id}/risk_history"
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with unknown site id" do
      it "returns 404" do
        get "/api/sites/00000000-0000-0000-0000-000000000000/risk_history",
            headers: auth_headers(current_user)
        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
