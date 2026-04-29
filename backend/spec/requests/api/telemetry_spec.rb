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
    let(:broadcaster) { instance_double(Telemetry::Broadcaster, subscribe: queue, unsubscribe: nil, update_subscription: nil) }

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

    it "releases the pre-loop DB connection so an SSE stream does not pin a pool slot for its lifetime" do
      # Regression for the connection-pinning class of bug: ActionController::Live
      # would otherwise hold the controller's checked-out connection for the
      # entire stream lifetime. With prod pool=25, ~25 concurrent streams
      # would exhaust the pool and every other API request would block on
      # ConnectionTimeoutError. The controller now explicitly releases the
      # connection before entering queue.pop and uses with_connection for
      # in-loop queries.
      queue.close

      expect(ActiveRecord::Base.connection_pool).to receive(:release_connection).at_least(:once).and_call_original

      get "/api/telemetry/stream", params: { token: sse_token }

      expect(response).to have_http_status(:ok)
    end

    describe "tenant filtering" do
      # Exercises the per-payload guard in TelemetryController#stream. The
      # broadcaster is always global (single-process in-memory pub/sub); the
      # stream loop must drop payloads whose asset_id is outside the viewer's
      # AssetPolicy::Scope. Covers both axes (organization + area_of_operation)
      # and the compound case where both are pinned.

      let(:queue) { Queue.new }
      let(:broadcaster) { instance_double(Telemetry::Broadcaster, subscribe: queue, unsubscribe: nil, update_subscription: nil) }

      before do
        allow(Telemetry::Broadcaster).to receive(:instance).and_return(broadcaster)
      end

      def push_reading(q, asset)
        q.push({
          asset_id: asset.id,
          name:     asset.name,
          lat:      1.0,
          lng:      2.0,
          heading:  0,
          speed:    0,
          battery:  100,
          ts:       Time.current.to_i,
        }.to_json)
      end

      def open_stream_as(user)
        token = JwtAuthenticatable.encode_sse(user.id)
        get "/api/telemetry/stream", params: { token: token }
      end

      it "unrestricted viewer (no org, no AO) receives every reading" do
        unrestricted = create(:user, :commander)
        push_reading(queue, asset_a)
        push_reading(queue, asset_b)
        queue.close

        open_stream_as(unrestricted)

        expect(response).to have_http_status(:ok)
        expect(response.body.scan("event: telemetry").size).to eq(2)
        expect(response.body).to include(%("asset_id":"#{asset_a.id}"))
        expect(response.body).to include(%("asset_id":"#{asset_b.id}"))
      end

      it "org-only viewer drops cross-organization readings" do
        org_a = create(:organization)
        org_b = create(:organization)
        site_a = create(:site, organization: org_a)
        site_b = create(:site, organization: org_b)
        asset_org_a = create(:asset, name: "Org A Asset", home_site: site_a)
        asset_org_b = create(:asset, name: "Org B Asset", home_site: site_b)

        viewer = create(:user, :commander, organization: org_a)

        push_reading(queue, asset_org_a)
        push_reading(queue, asset_org_b)
        queue.close

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        expect(response.body.scan("event: telemetry").size).to eq(1)
        expect(response.body).to include(%("asset_id":"#{asset_org_a.id}"))
        expect(response.body).not_to include(%("asset_id":"#{asset_org_b.id}"))
      end

      it "AO-only viewer drops cross-area-of-operation readings" do
        ao_1 = create(:area_of_operation)
        ao_2 = create(:area_of_operation)
        site_ao_1 = create(:site, area_of_operation: ao_1)
        site_ao_2 = create(:site, area_of_operation: ao_2)
        asset_ao_1 = create(:asset, name: "AO 1 Asset", home_site: site_ao_1)
        asset_ao_2 = create(:asset, name: "AO 2 Asset", home_site: site_ao_2)

        viewer = create(:user, :commander, area_of_operation: ao_1)

        push_reading(queue, asset_ao_1)
        push_reading(queue, asset_ao_2)
        queue.close

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        expect(response.body.scan("event: telemetry").size).to eq(1)
        expect(response.body).to include(%("asset_id":"#{asset_ao_1.id}"))
        expect(response.body).not_to include(%("asset_id":"#{asset_ao_2.id}"))
      end

      it "compound org+AO viewer filters on both axes simultaneously" do
        org_a = create(:organization)
        org_b = create(:organization)
        ao_1_in_org_a = create(:area_of_operation, organization: org_a)
        ao_2_in_org_a = create(:area_of_operation, organization: org_a)
        ao_1_in_org_b = create(:area_of_operation, organization: org_b)

        site_match    = create(:site, organization: org_a, area_of_operation: ao_1_in_org_a)
        site_wrong_ao = create(:site, organization: org_a, area_of_operation: ao_2_in_org_a)
        site_wrong_org = create(:site, organization: org_b, area_of_operation: ao_1_in_org_b)

        asset_match     = create(:asset, name: "Match", home_site: site_match)
        asset_wrong_ao  = create(:asset, name: "Wrong AO", home_site: site_wrong_ao)
        asset_wrong_org = create(:asset, name: "Wrong Org", home_site: site_wrong_org)

        viewer = create(:user, :commander, organization: org_a, area_of_operation: ao_1_in_org_a)

        push_reading(queue, asset_match)
        push_reading(queue, asset_wrong_ao)
        push_reading(queue, asset_wrong_org)
        queue.close

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        expect(response.body.scan("event: telemetry").size).to eq(1)
        expect(response.body).to include(%("asset_id":"#{asset_match.id}"))
        expect(response.body).not_to include(%("asset_id":"#{asset_wrong_ao.id}"))
        expect(response.body).not_to include(%("asset_id":"#{asset_wrong_org.id}"))
      end

      it "empty-scope viewer (org with zero visible assets) drops every payload but keeps the stream open" do
        org_empty = create(:organization)
        viewer = create(:user, :commander, organization: org_empty)

        push_reading(queue, asset_a)
        push_reading(queue, asset_b)
        queue.close

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("event: connected")
        expect(response.body).not_to include("event: telemetry")
      end

      it "re-evaluates allowed_asset_ids mid-stream so revoked access stops delivery" do
        # Regression: without a periodic refresh, a long-lived SSE stream
        # (hours) continued to deliver telemetry for assets the viewer lost
        # visibility into mid-stream (reassignment, AO revocation). The
        # refresh cadence is ALLOWED_ASSETS_REFRESH_SECONDS; stub to 0 so
        # it fires on every loop iteration and we can assert on behaviour
        # inside a single request.
        stub_const("Api::TelemetryController::ALLOWED_ASSETS_REFRESH_SECONDS", 0)

        # Build an org-scoped site + asset so the viewer is actually
        # restricted. The default `site` factory has no organization,
        # which makes policy_scope(Asset) return everything.
        org_a            = create(:organization)
        foreign_org      = create(:organization)
        scoped_site      = create(:site, organization: org_a)
        scoped_asset     = create(:asset, name: "Scoped Asset", home_site: scoped_site)
        viewer           = create(:user, :commander, organization: org_a)

        # A queue that reassigns the asset's home_site to a foreign org
        # between the first and second pop — simulates the scope
        # revocation that the refresh must catch up with.
        payloads = [
          { asset_id: scoped_asset.id, name: scoped_asset.name, lat: 1.0, lng: 2.0, heading: 0, speed: 0, battery: 100, ts: 1 }.to_json,
          { asset_id: scoped_asset.id, name: scoped_asset.name, lat: 1.1, lng: 2.1, heading: 0, speed: 0, battery: 100, ts: 2 }.to_json,
        ]
        mid_stream_queue = Class.new do
          def initialize(payloads, site, new_org)
            @payloads = payloads.dup
            @site = site
            @new_org = new_org
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            @site.update!(organization: @new_org) if @pop_count == 2
            @payloads.shift
          end
          def close; end
        end.new(payloads, scoped_site, foreign_org)
        allow(Telemetry::Broadcaster).to receive(:instance).and_return(
          instance_double(Telemetry::Broadcaster, subscribe: mid_stream_queue, unsubscribe: nil, update_subscription: nil)
        )

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        # First payload landed while the viewer still had access — delivered.
        expect(response.body).to include(%("ts":1))
        # Second payload popped after the reassignment; refresh picks up the
        # empty scope and the payload is filtered out.
        expect(response.body).not_to include(%("ts":2))
      end

      # ── A.3 sibling: USER reassignment (vs. ASSET reassignment above) ─────
      # The pre-existing refresh above caught ASSET reassignment because it
      # re-queries the Asset table each tick. But it passed the in-memory
      # `current_user` (cached at stream open) into AssetPolicy::Scope, so
      # USER reassignment (admin moves user from org A to org B) was
      # invisible to the scope refresh — policy_scope kept resolving against
      # the user's stream-open org. The fix reloads the User from the DB
      # uncached and feeds the FRESH user into the policy.
      it "re-resolves policy_scope against a freshly-reloaded User so user reassignment takes effect mid-stream" do
        stub_const("Api::TelemetryController::ALLOWED_ASSETS_REFRESH_SECONDS", 0)

        org_a    = create(:organization)
        org_b    = create(:organization)
        site_a   = create(:site, organization: org_a)
        site_b   = create(:site, organization: org_b)
        asset_a  = create(:asset, name: "Asset in org A", home_site: site_a)
        asset_b  = create(:asset, name: "Asset in org B", home_site: site_b)
        viewer   = create(:user, :commander, organization: org_a)

        payloads = [
          { asset_id: asset_a.id, name: asset_a.name, lat: 1.0, lng: 2.0, heading: 0, speed: 0, battery: 100, ts: 1 }.to_json,
          { asset_id: asset_a.id, name: asset_a.name, lat: 1.1, lng: 2.1, heading: 0, speed: 0, battery: 100, ts: 2 }.to_json,
        ]
        # Reassign the USER (not the asset) between pops. After reassignment,
        # asset_a (org A) should no longer be visible to viewer (now org B).
        mid_stream_queue = Class.new do
          def initialize(payloads, viewer, new_org)
            @payloads = payloads.dup
            @viewer = viewer
            @new_org = new_org
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            @viewer.update!(organization: @new_org) if @pop_count == 2
            @payloads.shift
          end
          def close; end
        end.new(payloads, viewer, org_b)
        allow(Telemetry::Broadcaster).to receive(:instance).and_return(
          instance_double(Telemetry::Broadcaster, subscribe: mid_stream_queue, unsubscribe: nil, update_subscription: nil)
        )

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        # First payload: viewer still in org A → asset_a visible → delivered.
        expect(response.body).to include(%("ts":1))
        # Second payload popped after user reassigned to org B. Without the
        # fix, the stale in-memory current_user.organization_id = org_a.id
        # would let policy_scope keep returning asset_a; with the fix, the
        # reloaded user has org_b, asset_a is filtered out.
        expect(response.body).not_to include(%("ts":2))
      end

      it "closes the telemetry stream when the user record is deleted mid-stream" do
        stub_const("Api::TelemetryController::ALLOWED_ASSETS_REFRESH_SECONDS", 0)

        org_a   = create(:organization)
        site_a  = create(:site, organization: org_a)
        asset_a = create(:asset, name: "Scoped Asset", home_site: site_a)
        viewer  = create(:user, :commander, organization: org_a)

        payloads = [
          { asset_id: asset_a.id, name: asset_a.name, lat: 1.0, lng: 2.0, heading: 0, speed: 0, battery: 100, ts: 1 }.to_json,
          { asset_id: asset_a.id, name: asset_a.name, lat: 1.1, lng: 2.1, heading: 0, speed: 0, battery: 100, ts: 2 }.to_json,
        ]
        delete_aware_queue = Class.new do
          def initialize(payloads, viewer)
            @payloads = payloads.dup
            @viewer = viewer
            @pop_count = 0
          end
          def pop
            @pop_count += 1
            @viewer.destroy! if @pop_count == 2
            @payloads.shift
          end
          def close; end
        end.new(payloads, viewer)

        broadcaster_double = instance_double(
          Telemetry::Broadcaster,
          subscribe: delete_aware_queue,
          unsubscribe: nil,
          update_subscription: nil,
        )
        allow(Telemetry::Broadcaster).to receive(:instance).and_return(broadcaster_double)

        open_stream_as(viewer)

        expect(response).to have_http_status(:ok)
        # First event delivered before the deletion took effect.
        expect(response.body).to include(%("ts":1))
        # Second pop's refresh tick detects the gone user and breaks.
        expect(response.body).not_to include(%("ts":2))
        expect(broadcaster_double).to have_received(:unsubscribe).with(delete_aware_queue)
      end
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
