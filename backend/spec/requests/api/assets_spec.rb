require "rails_helper"

RSpec.describe "Api::Assets", type: :request do
  let!(:site_a) { create(:site) }
  let!(:site_b) { create(:site) }
  let!(:vehicle)   { create(:asset, name: "MRAP-01", asset_type: "vehicle",   status: "available", home_site: site_a) }
  let!(:equipment) { create(:asset, name: "Comms-B", asset_type: "equipment", status: "in_use",    home_site: site_b) }
  let!(:orphan)    { create(:asset, name: "Spare",   asset_type: "equipment", status: "offline",   home_site: nil) }

  describe "GET /api/assets" do
    it "returns 200 with all assets" do
      get "/api/assets"
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).map { |a| a["id"] }
      expect(ids).to contain_exactly(vehicle.id, equipment.id, orphan.id)
    end

    it "filters by home_site_id" do
      get "/api/assets", params: { home_site_id: site_a.id }
      ids = JSON.parse(response.body).map { |a| a["id"] }
      expect(ids).to eq([vehicle.id])
    end

    it "filters by status" do
      get "/api/assets", params: { status: "in_use" }
      ids = JSON.parse(response.body).map { |a| a["id"] }
      expect(ids).to eq([equipment.id])
    end

    it "filters by asset_type" do
      get "/api/assets", params: { asset_type: "vehicle" }
      ids = JSON.parse(response.body).map { |a| a["id"] }
      expect(ids).to eq([vehicle.id])
    end

    it "returns expected fields" do
      get "/api/assets"
      asset = JSON.parse(response.body).first
      expect(asset.keys).to include("id", "name", "asset_type", "status", "home_site_id", "created_at")
    end
  end

  describe "GET /api/assets/:id" do
    it "returns 200 with the asset" do
      get "/api/assets/#{vehicle.id}"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(vehicle.id)
    end

    it "returns 404 for an unknown id" do
      get "/api/assets/00000000-0000-0000-0000-000000000000"
      expect(response).to have_http_status(:not_found)
    end
  end
end
