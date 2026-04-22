require "rails_helper"

RSpec.describe "Api::Vessels", type: :request do
  let(:user) { create(:user) }
  let(:org_scoped_user) { create(:user, organization: create(:organization)) }

  let!(:vessel1) { create(:vessel, name: "MV ALPHA", mmsi: "111000001") }
  let!(:vessel2) { create(:vessel, :loitering, name: "MV BRAVO", mmsi: "111000002") }
  let!(:track1)  { create(:vessel_track, vessel: vessel1, occurred_at: 2.hours.ago) }
  let!(:track2)  { create(:vessel_track, vessel: vessel1, occurred_at: 1.hour.ago) }

  describe "GET /api/vessels" do
    it "returns 200 with data array and pagination meta" do
      get "/api/vessels", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns all vessels" do
      get "/api/vessels", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["meta"]["total"]).to eq(2)
    end

    it "returns expected fields on each vessel" do
      get "/api/vessels", headers: auth_headers(user)
      v = JSON.parse(response.body)["data"].first
      expect(v.keys).to include(
        "id", "mmsi", "name", "vessel_type", "flag",
        "lat", "lng", "speed", "heading",
        "first_seen_at", "last_seen_at", "loitering_since",
        "dark", "loitering", "last_signal_id"
      )
    end

    it "filters by mmsi" do
      get "/api/vessels", params: { mmsi: "111000001" }, headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["data"].length).to eq(1)
      expect(body["data"].first["id"]).to eq(vessel1.id)
    end

    it "filters loitering vessels" do
      get "/api/vessels", params: { loitering: true }, headers: auth_headers(user)
      body = JSON.parse(response.body)
      ids = body["data"].map { |v| v["id"] }
      expect(ids).to contain_exactly(vessel2.id)
    end

    it "requires authentication" do
      get "/api/vessels"
      expect(response).to have_http_status(:unauthorized)
    end

    it "still exposes global vessels to org-scoped users" do
      get "/api/vessels", headers: auth_headers(org_scoped_user)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("meta", "total")).to eq(2)
    end
  end

  describe "GET /api/vessels/:id" do
    it "returns 200 with the vessel" do
      get "/api/vessels/#{vessel1.id}", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(vessel1.id)
      expect(body["mmsi"]).to eq("111000001")
      expect(body["name"]).to eq("MV ALPHA")
    end

    it "returns 404 for unknown UUID" do
      get "/api/vessels/#{SecureRandom.uuid}", headers: auth_headers(user)
      expect(response).to have_http_status(:not_found)
    end

    it "requires authentication" do
      get "/api/vessels/#{vessel1.id}"
      expect(response).to have_http_status(:unauthorized)
    end

    it "still allows org-scoped users to read a global vessel" do
      get "/api/vessels/#{vessel1.id}", headers: auth_headers(org_scoped_user)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).fetch("id")).to eq(vessel1.id)
    end
  end

  describe "GET /api/vessels/:id/tracks" do
    it "returns 200 with track array" do
      get "/api/vessels/#{vessel1.id}/tracks", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["data"].length).to eq(2)
    end

    it "returns expected fields on each track" do
      get "/api/vessels/#{vessel1.id}/tracks", headers: auth_headers(user)
      t = JSON.parse(response.body)["data"].first
      expect(t.keys).to include("id", "lat", "lng", "speed", "heading", "occurred_at")
    end

    it "returns tracks in chronological order" do
      get "/api/vessels/#{vessel1.id}/tracks", headers: auth_headers(user)
      times = JSON.parse(response.body)["data"].map { |t| t["occurred_at"] }
      expect(times).to eq(times.sort)
    end

    it "returns empty array for vessel with no tracks" do
      get "/api/vessels/#{vessel2.id}/tracks", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"]).to eq([])
    end

    it "filters by from/to datetime range" do
      from = 90.minutes.ago.iso8601
      to   = 30.minutes.ago.iso8601
      get "/api/vessels/#{vessel1.id}/tracks", params: { from: from, to: to }, headers: auth_headers(user)
      body = JSON.parse(response.body)
      # Only track2 (1 hour ago) falls in the 90m–30m window
      expect(body["data"].length).to eq(1)
      expect(body["data"].first["id"]).to eq(track2.id)
    end

    it "returns 400 when from is an invalid datetime" do
      get "/api/vessels/#{vessel1.id}/tracks", params: { from: "not-a-datetime" }, headers: auth_headers(user)

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)["errors"]).to include(match(/from/))
    end

    it "returns 400 when to is an invalid datetime" do
      get "/api/vessels/#{vessel1.id}/tracks", params: { to: "garbage" }, headers: auth_headers(user)

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)["errors"]).to include(match(/to/))
    end

    it "supports an upper-bound only replay query" do
      cutoff = 90.minutes.ago.iso8601

      get "/api/vessels/#{vessel1.id}/tracks", params: { to: cutoff }, headers: auth_headers(user)

      body = JSON.parse(response.body)
      expect(body["data"].map { |t| t["id"] }).to eq([track1.id])
    end

    it "returns the most recent limited slice in chronological order" do
      track3 = create(:vessel_track, vessel: vessel1, occurred_at: 30.minutes.ago)

      get "/api/vessels/#{vessel1.id}/tracks", params: { limit: 2 }, headers: auth_headers(user)

      body = JSON.parse(response.body)
      expect(body["data"].map { |t| t["id"] }).to eq([track2.id, track3.id])
      expect(body["data"].map { |t| t["occurred_at"] }).to eq(
        body["data"].map { |t| t["occurred_at"] }.sort
      )
    end

    it "requires authentication" do
      get "/api/vessels/#{vessel1.id}/tracks"
      expect(response).to have_http_status(:unauthorized)
    end

    it "still allows org-scoped users to read global vessel tracks" do
      get "/api/vessels/#{vessel1.id}/tracks", headers: auth_headers(org_scoped_user)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).fetch("data").length).to eq(2)
    end
  end
end
