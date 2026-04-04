require "rails_helper"

RSpec.describe "Api::Sites", type: :request do
  let(:current_user) { create(:user, :commander) }
  let!(:alpha)   { create(:site, name: "Alpha", status: "active") }
  let!(:bravo)   { create(:site, name: "Bravo", status: "active") }
  let!(:charlie) { create(:site, :inactive, name: "Charlie") }

  describe "GET /api/sites" do
    it "returns 200 with all sites in data array" do
      get "/api/sites", headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to contain_exactly(alpha.id, bravo.id, charlie.id)
    end

    it "returns sites in name order" do
      get "/api/sites", headers: auth_headers(current_user)
      names = JSON.parse(response.body)["data"].map { |s| s["name"] }
      expect(names).to eq(names.sort)
    end

    it "filters by status" do
      get "/api/sites", params: { status: "inactive" }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to eq([charlie.id])
    end

    it "returns expected fields on each record" do
      get "/api/sites", headers: auth_headers(current_user)
      site = JSON.parse(response.body)["data"].first
      expect(site.keys).to include("id", "name", "latitude", "longitude", "status", "created_at")
    end

    it "returns pagination meta" do
      get "/api/sites", headers: auth_headers(current_user)
      meta = JSON.parse(response.body)["meta"]
      expect(meta["total"]).to eq(3)
      expect(meta["page"]).to eq(1)
      expect(meta["per_page"]).to eq(50)
      expect(meta["total_pages"]).to eq(1)
    end

    it "respects per_page" do
      get "/api/sites", params: { per_page: 2 }, headers: auth_headers(current_user)
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(2)
      expect(body["meta"]["total"]).to eq(3)
      expect(body["meta"]["total_pages"]).to eq(2)
    end

    it "returns page 2" do
      get "/api/sites", params: { per_page: 2, page: 2 }, headers: auth_headers(current_user)
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(1)
      expect(body["meta"]["page"]).to eq(2)
    end

    it "caps per_page at 200" do
      get "/api/sites", params: { per_page: 9999 }, headers: auth_headers(current_user)
      expect(JSON.parse(response.body)["meta"]["per_page"]).to eq(200)
    end
  end

  describe "GET /api/sites/:id" do
    it "returns 200 with the site (no pagination wrapper)" do
      get "/api/sites/#{alpha.id}", headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(alpha.id)
      expect(body["name"]).to eq("Alpha")
    end

    it "returns 404 for an unknown id" do
      get "/api/sites/00000000-0000-0000-0000-000000000000", headers: auth_headers(current_user)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "PATCH /api/sites/:id/toggle_status" do
    let(:operator) { create(:user, role: "operator") }

    it "toggles site status and broadcasts site_risk_updated" do
      broadcaster = instance_double(Sse::Broadcaster)
      allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
      allow(broadcaster).to receive(:publish)

      patch "/api/sites/#{alpha.id}/toggle_status", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      expect(alpha.reload.status).to eq("inactive")
      expect(broadcaster).to have_received(:publish).with(
        hash_including(event: "site_risk_updated", data: { site_id: alpha.id })
      )
    end

    it "returns 403 for operators" do
      patch "/api/sites/#{alpha.id}/toggle_status", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/sites/:id/unflag" do
    let!(:flagged_site) { create(:site, name: "Flagged", flagged_at: 1.hour.ago, flag_reason: "Test") }

    it "clears flag and broadcasts site_risk_updated" do
      broadcaster = instance_double(Sse::Broadcaster)
      allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
      allow(broadcaster).to receive(:publish)

      patch "/api/sites/#{flagged_site.id}/unflag", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      expect(flagged_site.reload.flagged_at).to be_nil
      expect(broadcaster).to have_received(:publish).with(
        hash_including(event: "site_risk_updated", data: { site_id: flagged_site.id })
      )
    end

    it "returns 422 when site is not flagged" do
      patch "/api/sites/#{alpha.id}/unflag", headers: auth_headers(current_user)
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /api/sites/:id/update_geofence" do
    let(:operator) { create(:user, role: "operator") }

    it "updates the geofence radius for commanders" do
      patch "/api/sites/#{alpha.id}/update_geofence",
            params:  { geofence_radius_km: 12.5 },
            headers: auth_headers(current_user), as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["geofence_radius_km"]).to eq(12.5)
      expect(alpha.reload.geofence_radius_km).to eq(12.5)
    end

    it "returns 422 when radius is zero or negative" do
      patch "/api/sites/#{alpha.id}/update_geofence",
            params:  { geofence_radius_km: 0 },
            headers: auth_headers(current_user), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to be_present
    end

    it "returns 403 for operators" do
      patch "/api/sites/#{alpha.id}/update_geofence",
            params:  { geofence_radius_km: 5.0 },
            headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "returns 404 for an unknown site" do
      patch "/api/sites/00000000-0000-0000-0000-000000000000/update_geofence",
            params:  { geofence_radius_km: 5.0 },
            headers: auth_headers(current_user), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "broadcasts site_risk_updated on success" do
      broadcaster = instance_double(Sse::Broadcaster)
      allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
      allow(broadcaster).to receive(:publish)

      patch "/api/sites/#{alpha.id}/update_geofence",
            params:  { geofence_radius_km: 8.0 },
            headers: auth_headers(current_user), as: :json

      expect(broadcaster).to have_received(:publish).with(
        hash_including(event: "site_risk_updated", data: { site_id: alpha.id })
      )
    end
  end
end
