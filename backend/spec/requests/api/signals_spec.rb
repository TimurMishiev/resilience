require "rails_helper"

RSpec.describe "Api::Signals", type: :request do
  let(:user) { create(:user) }

  let!(:seismic1) do
    create(:external_signal,
           source: "usgs_seismic", signal_type: "seismic_event",
           lat: 51.5, lng: 0.0, occurred_at: 2.hours.ago)
  end
  let!(:seismic2) do
    create(:external_signal,
           source: "usgs_seismic", signal_type: "seismic_event",
           lat: 48.9, lng: 2.4, occurred_at: 30.minutes.ago)
  end
  let!(:aircraft) do
    create(:external_signal, :aircraft,
           lat: 52.0, lng: 1.0, occurred_at: 1.hour.ago)
  end
  let!(:wildfire) do
    create(:external_signal, :wildfire,
           lat: 35.0, lng: 36.0, occurred_at: 3.hours.ago)
  end

  describe "GET /api/signals" do
    it "returns 200 with data array and pagination meta" do
      get "/api/signals", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns all signals ordered by occurred_at desc" do
      get "/api/signals", headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["meta"]["total"]).to eq(4)
      times = body["data"].map { |s| s["occurred_at"] }
      expect(times).to eq(times.sort.reverse)
    end

    it "returns expected fields on each record" do
      get "/api/signals", headers: auth_headers(user)
      s = JSON.parse(response.body)["data"].first
      expect(s.keys).to include(
        "id", "source", "signal_type", "external_id",
        "lat", "lng", "occurred_at", "ingested_at"
      )
    end

    it "filters by source" do
      get "/api/signals", params: { source: "opensky" }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to contain_exactly(aircraft.id)
    end

    it "filters by signal_type" do
      get "/api/signals", params: { signal_type: "seismic_event" }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to contain_exactly(seismic1.id, seismic2.id)
    end

    it "filters by from datetime" do
      from = 1.hour.ago.iso8601
      get "/api/signals", params: { from: from }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to include(seismic2.id, aircraft.id)
      expect(ids).not_to include(wildfire.id)
    end

    it "filters by to datetime" do
      to = 1.5.hours.ago.iso8601
      get "/api/signals", params: { to: to }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to include(seismic1.id, wildfire.id)
      expect(ids).not_to include(seismic2.id)
    end

    it "filters by as_of datetime" do
      as_of = 45.minutes.ago.iso8601
      get "/api/signals", params: { as_of: as_of }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to include(seismic1.id, wildfire.id, aircraft.id)
      expect(ids).not_to include(seismic2.id)
    end

    it "applies the earlier of to and as_of as the upper bound" do
      get "/api/signals",
          params: {
            to: 30.minutes.ago.iso8601,
            as_of: 1.5.hours.ago.iso8601,
          },
          headers: auth_headers(user)

      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      expect(ids).to include(seismic1.id, wildfire.id)
      expect(ids).not_to include(seismic2.id, aircraft.id)
    end

    it "filters by site_id using proximity bounding box" do
      # Site near London (51.5, 0.0) — should match seismic1 and aircraft but not wildfire
      site = create(:site, latitude: 51.5, longitude: 0.0)
      get "/api/signals", params: { site_id: site.id }, headers: auth_headers(user)
      ids = JSON.parse(response.body)["data"].map { |s| s["id"] }
      # wildfire at (35, 36) is >200 km away — bounding box pre-filter excludes it
      expect(ids).not_to include(wildfire.id)
    end

    it "ignores unknown site_id gracefully" do
      get "/api/signals", params: { site_id: SecureRandom.uuid }, headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
    end

    it "requires authentication" do
      get "/api/signals"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/signals/:id" do
    it "returns 200 with the signal" do
      get "/api/signals/#{seismic1.id}", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(seismic1.id)
      expect(body["source"]).to eq("usgs_seismic")
      expect(body["signal_type"]).to eq("seismic_event")
      expect(body["raw_payload"]).to be_a(Hash)
    end

    it "returns 404 for unknown UUID" do
      get "/api/signals/#{SecureRandom.uuid}", headers: auth_headers(user)
      expect(response).to have_http_status(:not_found)
    end
  end
end
