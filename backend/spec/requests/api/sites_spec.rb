require "rails_helper"

RSpec.describe "Api::Sites", type: :request do
  let!(:alpha)   { create(:site, name: "Alpha", status: "active") }
  let!(:bravo)   { create(:site, name: "Bravo", status: "active") }
  let!(:charlie) { create(:site, :inactive, name: "Charlie") }

  describe "GET /api/sites" do
    it "returns 200 with all sites in data array" do
      get "/api/sites"
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to contain_exactly(alpha.id, bravo.id, charlie.id)
    end

    it "returns sites in name order" do
      get "/api/sites"
      names = JSON.parse(response.body)["data"].map { |s| s["name"] }
      expect(names).to eq(names.sort)
    end

    it "filters by status" do
      get "/api/sites", params: { status: "inactive" }
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to eq([charlie.id])
    end

    it "returns expected fields on each record" do
      get "/api/sites"
      site = JSON.parse(response.body)["data"].first
      expect(site.keys).to include("id", "name", "latitude", "longitude", "status", "created_at")
    end

    it "returns pagination meta" do
      get "/api/sites"
      meta = JSON.parse(response.body)["meta"]
      expect(meta["total"]).to eq(3)
      expect(meta["page"]).to eq(1)
      expect(meta["per_page"]).to eq(50)
      expect(meta["total_pages"]).to eq(1)
    end

    it "respects per_page" do
      get "/api/sites", params: { per_page: 2 }
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(2)
      expect(body["meta"]["total"]).to eq(3)
      expect(body["meta"]["total_pages"]).to eq(2)
    end

    it "returns page 2" do
      get "/api/sites", params: { per_page: 2, page: 2 }
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(1)
      expect(body["meta"]["page"]).to eq(2)
    end

    it "caps per_page at 200" do
      get "/api/sites", params: { per_page: 9999 }
      expect(JSON.parse(response.body)["meta"]["per_page"]).to eq(200)
    end
  end

  describe "GET /api/sites/:id" do
    it "returns 200 with the site (no pagination wrapper)" do
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
