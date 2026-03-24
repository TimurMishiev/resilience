require "rails_helper"

RSpec.describe "Api::Telemetry", type: :request do
  let(:current_user) { create(:user, :commander) }
  let!(:site) { create(:site) }
  let!(:asset_a) { create(:asset, name: "Asset Alpha", home_site: site) }
  let!(:asset_b) { create(:asset, name: "Asset Bravo", home_site: site) }

  describe "GET /api/telemetry" do
    it "returns the latest telemetry reading per asset" do
      create(:telemetry_reading, asset: asset_a, battery: 70.0, occurred_at: 10.minutes.ago)
      latest = create(:telemetry_reading, asset: asset_a, battery: 65.0, occurred_at: 2.minutes.ago)
      create(:telemetry_reading, asset: asset_b, battery: 90.0, occurred_at: 5.minutes.ago)

      get "/api/telemetry", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(2)
      alpha = body["data"].find { |row| row["asset_id"] == asset_a.id }
      expect(alpha["battery"]).to eq(latest.battery)
      expect(alpha["ts"]).to eq(latest.occurred_at.to_i)
    end

    it "returns the latest telemetry reading per asset as of the requested replay time" do
      create(:telemetry_reading, asset: asset_a, battery: 80.0, occurred_at: 20.minutes.ago)
      historical = create(:telemetry_reading, asset: asset_a, battery: 72.0, occurred_at: 12.minutes.ago)
      create(:telemetry_reading, asset: asset_a, battery: 64.0, occurred_at: 2.minutes.ago)

      create(:telemetry_reading, asset: asset_b, battery: 88.0, occurred_at: 30.minutes.ago)
      create(:telemetry_reading, asset: asset_b, battery: 83.0, occurred_at: 1.minute.ago)

      get "/api/telemetry",
          params: { as_of: 10.minutes.ago.iso8601 },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.dig("meta", "as_of")).to be_present
      expect(body["data"].size).to eq(2)

      alpha = body["data"].find { |row| row["asset_id"] == asset_a.id }
      bravo = body["data"].find { |row| row["asset_id"] == asset_b.id }
      expect(alpha["battery"]).to eq(historical.battery)
      expect(alpha["ts"]).to eq(historical.occurred_at.to_i)
      expect(bravo["battery"]).to eq(88.0)
    end

    it "requires authentication" do
      get "/api/telemetry"
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
