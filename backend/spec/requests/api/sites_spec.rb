require "rails_helper"

RSpec.describe "GET /api/sites", type: :request do
  let!(:alpha)   { create(:site, name: "Alpha", status: "active") }
  let!(:bravo)   { create(:site, name: "Bravo", status: "active") }
  let!(:charlie) { create(:site, :inactive, name: "Charlie") }

  describe "GET /api/sites" do
    it "returns 200 with all sites" do
      get "/api/sites"
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).map { |s| s["id"] }
      expect(ids).to contain_exactly(alpha.id, bravo.id, charlie.id)
    end

    it "returns sites in name order" do
      get "/api/sites"
      names = JSON.parse(response.body).map { |s| s["name"] }
      expect(names).to eq(names.sort)
    end

    it "filters by status" do
      get "/api/sites", params: { status: "inactive" }
      ids = JSON.parse(response.body).map { |s| s["id"] }
      expect(ids).to eq([charlie.id])
    end

    it "returns expected fields" do
      get "/api/sites"
      site = JSON.parse(response.body).first
      expect(site.keys).to include("id", "name", "latitude", "longitude", "status", "created_at")
    end
  end

  describe "GET /api/sites/:id" do
    it "returns 200 with the site" do
      get "/api/sites/#{alpha.id}"
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(alpha.id)
      expect(body["name"]).to eq("Alpha")
    end

    it "returns 404 for an unknown id" do
      get "/api/sites/00000000-0000-0000-0000-000000000000"
      expect(response).to have_http_status(:not_found)
    end
  end
end
