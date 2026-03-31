require "rails_helper"

RSpec.describe "Api::Telemetry", type: :request do
  let(:current_user) { create(:user, :commander) }
  let!(:site) { create(:site) }
  let!(:asset_a) { create(:asset, name: "Asset Alpha", home_site: site) }
  let!(:asset_b) { create(:asset, name: "Asset Bravo", home_site: site) }
  let(:sse_token) { JwtAuthenticatable.encode_sse(current_user.id) }

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

  describe "GET /api/telemetry/trails" do
    it "returns windowed trail points grouped by asset" do
      # asset_a: 3 readings spread across the window
      create(:telemetry_reading, asset: asset_a, lat: 10.0, lng: 20.0, heading: 90, occurred_at: 25.minutes.ago)
      create(:telemetry_reading, asset: asset_a, lat: 10.1, lng: 20.1, heading: 91, occurred_at: 15.minutes.ago)
      create(:telemetry_reading, asset: asset_a, lat: 10.2, lng: 20.2, heading: 92, occurred_at: 5.minutes.ago)

      # asset_b: 1 reading
      create(:telemetry_reading, asset: asset_b, lat: 30.0, lng: 40.0, heading: 180, occurred_at: 10.minutes.ago)

      get "/api/telemetry/trails", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"].size).to eq(2)
      expect(body["meta"]["window_minutes"]).to eq(30)
      expect(body["meta"]["asset_count"]).to eq(2)

      alpha = body["data"].find { |t| t["asset_id"] == asset_a.id }
      expect(alpha["points"].size).to eq(3)
      # Points are oldest-first
      expect(alpha["points"].first["lat"]).to eq(10.0)
      expect(alpha["points"].last["lat"]).to eq(10.2)
      expect(alpha["status"]).to be_present
    end

    it "respects as_of and window_minutes params" do
      create(:telemetry_reading, asset: asset_a, lat: 1.0, lng: 1.0, occurred_at: 50.minutes.ago)
      create(:telemetry_reading, asset: asset_a, lat: 2.0, lng: 2.0, occurred_at: 35.minutes.ago)
      create(:telemetry_reading, asset: asset_a, lat: 3.0, lng: 3.0, occurred_at: 20.minutes.ago)
      create(:telemetry_reading, asset: asset_a, lat: 4.0, lng: 4.0, occurred_at: 5.minutes.ago)

      get "/api/telemetry/trails",
          params: { as_of: 15.minutes.ago.iso8601, window_minutes: 25 },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      alpha = body["data"].find { |t| t["asset_id"] == asset_a.id }
      # Only readings between 40-min-ago and 15-min-ago: the 35m and 20m readings
      expect(alpha["points"].size).to eq(2)
      expect(alpha["points"].first["lat"]).to eq(2.0)
      expect(alpha["points"].last["lat"]).to eq(3.0)
      expect(body["meta"]["window_minutes"]).to eq(25)
    end

    it "caps points per asset at TRAIL_POINT_LIMIT (200)" do
      now = Time.current
      # Bulk-insert via raw SQL to avoid partitioned-table insert_all constraint.
      # String interpolation here is safe — all values are SecureRandom.uuid or
      # known-good factory IDs and numeric literals, never user-supplied input.
      values = 205.times.map do |i|
        ts = (now - (205 - i).seconds).utc.iso8601(6)
        "('#{SecureRandom.uuid}', '#{asset_a.id}', #{10.0 + (i * 0.001)}, 20.0, 90, 5.0, 80.0, '#{ts}', '#{ts}')"
      end.join(",\n")
      ActiveRecord::Base.connection.execute(<<~SQL)
        INSERT INTO telemetry_readings (id, asset_id, lat, lng, heading, speed, battery, occurred_at, created_at)
        VALUES #{values}
      SQL

      get "/api/telemetry/trails",
          params: { as_of: now.iso8601, window_minutes: 10 },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      alpha = body["data"].find { |t| t["asset_id"] == asset_a.id }
      expect(alpha["points"].size).to eq(200)
      # Oldest-first ordering preserved
      expect(alpha["points"].first["lat"]).to be < alpha["points"].last["lat"]
    end

    it "caps window_minutes at 120" do
      get "/api/telemetry/trails",
          params: { window_minutes: 999 },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meta"]["window_minutes"]).to eq(120)
    end

    it "returns empty data when no readings exist in window" do
      get "/api/telemetry/trails", headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to eq([])
      expect(body["meta"]["asset_count"]).to eq(0)
    end

    it "requires authentication" do
      get "/api/telemetry/trails"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/telemetry/stream" do
    let(:queue) { Queue.new }
    let(:broadcaster) { instance_double(Telemetry::Broadcaster, subscribe: queue, unsubscribe: nil) }

    before do
      allow(Telemetry::Broadcaster).to receive(:instance).and_return(broadcaster)
    end

    it "treats a closed queue as terminal without emitting empty telemetry frames" do
      queue.close

      get "/api/telemetry/stream", params: { token: sse_token }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("event: connected")
      expect(response.body).not_to include("event: telemetry")
      expect(broadcaster).to have_received(:unsubscribe).with(queue)
    end

    it "returns 429 when the remote IP is already at live stream capacity" do
      original_ip_limit = ENV["SSE_MAX_STREAMS_PER_IP"]
      ENV["SSE_MAX_STREAMS_PER_IP"] = "1"

      SseStreamLease.create!(
        user: create(:user),
        stream_name: "events",
        remote_ip: "127.0.0.1",
        lease_key: SecureRandom.uuid,
        expires_at: 5.minutes.from_now,
      )

      get "/api/telemetry/stream", params: { token: sse_token }

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body).fetch("errors").first).to match(/Too many live streams/)
    ensure
      original_ip_limit ? ENV["SSE_MAX_STREAMS_PER_IP"] = original_ip_limit : ENV.delete("SSE_MAX_STREAMS_PER_IP")
    end
  end
end
