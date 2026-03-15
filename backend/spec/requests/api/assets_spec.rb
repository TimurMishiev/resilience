require "rails_helper"

RSpec.describe "Api::Assets", type: :request do
  let(:current_user) { create(:user, :commander) }
  let!(:site_a) { create(:site) }
  let!(:site_b) { create(:site) }
  let!(:vehicle)   { create(:asset, name: "MRAP-01", asset_type: "vehicle",   status: "available", home_site: site_a) }
  let!(:equipment) { create(:asset, name: "Comms-B", asset_type: "equipment", status: "in_use",    home_site: site_b) }
  let!(:orphan)    { create(:asset, name: "Spare",   asset_type: "equipment", status: "offline",   home_site: nil) }

  describe "GET /api/assets" do
    it "returns 200 with all assets in data array" do
      get "/api/assets", headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["data"].map { |a| a["id"] }
      expect(ids).to contain_exactly(vehicle.id, equipment.id, orphan.id)
    end

    it "filters by home_site_id" do
      get "/api/assets", params: { home_site_id: site_a.id }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body)["data"].map { |a| a["id"] }
      expect(ids).to eq([vehicle.id])
    end

    it "filters by status" do
      get "/api/assets", params: { status: "in_use" }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body)["data"].map { |a| a["id"] }
      expect(ids).to eq([equipment.id])
    end

    it "filters by asset_type" do
      get "/api/assets", params: { asset_type: "vehicle" }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body)["data"].map { |a| a["id"] }
      expect(ids).to eq([vehicle.id])
    end

    it "returns expected fields on each record" do
      get "/api/assets", headers: auth_headers(current_user)
      asset = JSON.parse(response.body)["data"].first
      expect(asset.keys).to include("id", "name", "asset_type", "status", "home_site_id", "created_at")
    end

    it "returns pagination meta" do
      get "/api/assets", headers: auth_headers(current_user)
      meta = JSON.parse(response.body)["meta"]
      expect(meta["total"]).to eq(3)
      expect(meta["page"]).to eq(1)
    end
  end

  describe "GET /api/assets/:id" do
    it "returns 200 with the asset (no pagination wrapper)" do
      get "/api/assets/#{vehicle.id}", headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(vehicle.id)
    end

    it "returns 404 for an unknown id" do
      get "/api/assets/00000000-0000-0000-0000-000000000000", headers: auth_headers(current_user)
      expect(response).to have_http_status(:not_found)
    end
  end
end
