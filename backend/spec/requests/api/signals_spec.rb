require "rails_helper"

RSpec.describe "Api::Signals", type: :request do
  include ActiveSupport::Testing::TimeHelpers

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

    it "returns 400 when from is not a valid datetime" do
      get "/api/signals", params: { from: "not-a-date" }, headers: auth_headers(user)
      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)["errors"].first).to match(/from/)
    end

    it "returns 400 when to is not a valid datetime" do
      get "/api/signals", params: { to: "garbage" }, headers: auth_headers(user)
      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)["errors"].first).to match(/to/)
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

  describe "GET /api/signals/stream" do
    let(:sse_token) { JwtAuthenticatable.encode_sse(user.id) }
    let(:queue) { Queue.new }
    let(:broadcaster) { instance_double(Signals::Broadcaster, subscribe: queue, unsubscribe: nil) }

    around do |example|
      travel_to(Time.zone.parse("2026-03-25 16:00:00 UTC")) { example.run }
    end

    before do
      allow(Signals::Broadcaster).to receive(:instance).and_return(broadcaster)
    end

    it "returns 429 when the user is already at live stream capacity" do
      original_user_limit = ENV["SSE_MAX_STREAMS_PER_USER"]
      ENV["SSE_MAX_STREAMS_PER_USER"] = "1"

      SseStreamLease.create!(
        user: user,
        stream_name: "events",
        remote_ip: "127.0.0.1",
        lease_key: SecureRandom.uuid,
        expires_at: 5.minutes.from_now,
      )

      get "/api/signals/stream", params: { token: sse_token, since: 6.hours.ago.iso8601 }

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body).fetch("errors").first).to match(/Too many live streams/)
    ensure
      original_user_limit ? ENV["SSE_MAX_STREAMS_PER_USER"] = original_user_limit : ENV.delete("SSE_MAX_STREAMS_PER_USER")
    end

    it "streams a capped, batched signal baseline in ingested_at/id order" do
      queue << nil

      create(:external_signal).tap do |signal|
        signal.update_columns(
          occurred_at: 30.hours.ago,
          ingested_at: 30.hours.ago,
        )
      end

      create(:external_signal).tap do |signal|
        signal.update_columns(
          occurred_at: 1.minute.from_now,
          ingested_at: 1.minute.from_now,
        )
      end

      baseline_signals = Array.new(205) do |index|
        create(:external_signal, external_id: "baseline-#{index}").tap do |signal|
          ingested_at = 23.hours.ago + index.minutes
          signal.update_columns(
            occurred_at: ingested_at,
            ingested_at: ingested_at,
          )
        end
      end

      get "/api/signals/stream",
          params: { token: sse_token, since: 7.days.ago.iso8601 }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include('event: connected')

      streamed_payloads = response.body
        .scan(/^event: signal\ndata: (.+)$/)
        .flatten
        .map { |payload| JSON.parse(payload) }

      expected_ids = baseline_signals
        .sort_by { |signal| [signal.ingested_at, signal.id] }
        .map(&:id)

      expect(streamed_payloads.map { |payload| payload.fetch("id") }).to eq(expected_ids)
      expect(streamed_payloads).to all(satisfy { |payload|
        Time.zone.parse(payload.fetch("ingested_at")) >= 24.hours.ago &&
          Time.zone.parse(payload.fetch("ingested_at")) <= Time.current
      })
    end

    it "emits queued live payloads after the capped baseline replay completes" do
      baseline_signals = Array.new(3) do |index|
        create(:external_signal, external_id: "baseline-live-#{index}").tap do |signal|
          ingested_at = 10.minutes.ago + index.minutes
          signal.update_columns(
            occurred_at: ingested_at,
            ingested_at: ingested_at,
          )
        end
      end

      live_signal = create(:external_signal, signal_type: "gps_jamming", source: "gpsjam").tap do |signal|
        signal.update_columns(
          occurred_at: 1.minute.from_now,
          ingested_at: 1.minute.from_now,
        )
      end

      queue << Signals::PayloadSerializer.call(live_signal).to_json
      queue << nil

      get "/api/signals/stream",
          params: { token: sse_token, since: 6.hours.ago.iso8601 }

      expect(response).to have_http_status(:ok)

      streamed_payloads = response.body
        .scan(/^event: signal\ndata: (.+)$/)
        .flatten
        .map { |payload| JSON.parse(payload) }

      baseline_ids = baseline_signals
        .sort_by { |signal| [signal.ingested_at, signal.id] }
        .map(&:id)

      expect(streamed_payloads.map { |payload| payload.fetch("id") }).to eq([
        *baseline_ids,
        live_signal.id,
      ])
      expect(streamed_payloads.last.fetch("signal_type")).to eq("gps_jamming")
      expect(Time.zone.parse(streamed_payloads.last.fetch("ingested_at"))).to be > Time.current
    end

    it "replays signals created during a large baseline before switching to the live queue" do
      queue << nil

      baseline_signals = Array.new(205) do |index|
        create(:external_signal, external_id: "baseline-burst-#{index}").tap do |signal|
          ingested_at = 23.hours.ago + index.minutes
          signal.update_columns(
            occurred_at: ingested_at,
            ingested_at: ingested_at,
          )
        end
      end

      catchup_signals = []
      baseline_calls = 0

      allow_any_instance_of(Api::SignalsController)
        .to receive(:stream_signal_baseline)
        .and_wrap_original do |original, *args, **kwargs|
          baseline_calls += 1
          result = original.call(*args, **kwargs)

          next result unless baseline_calls == 1

          catchup_signals = Array.new(Signals::Broadcaster::MAX_QUEUE_SIZE + 25) do |index|
            create(:external_signal, external_id: "catchup-burst-#{index}").tap do |signal|
              signal.update_columns(
                occurred_at: Time.current,
                ingested_at: Time.current,
              )
            end
          end

          result
        end

      get "/api/signals/stream",
          params: { token: sse_token, since: 7.days.ago.iso8601 }

      expect(response).to have_http_status(:ok)

      streamed_payloads = response.body
        .scan(/^event: signal\ndata: (.+)$/)
        .flatten
        .map { |payload| JSON.parse(payload) }

      baseline_ids = baseline_signals
        .sort_by { |signal| [signal.ingested_at, signal.id] }
        .map(&:id)

      catchup_ids = catchup_signals
        .sort_by { |signal| [signal.ingested_at, signal.id] }
        .map(&:id)

      expect(streamed_payloads.map { |payload| payload.fetch("id") }).to eq([
        *baseline_ids,
        *catchup_ids,
      ])
    end

    it "does not subscribe to the live queue after a disconnect during baseline replay" do
      create(:external_signal, external_id: "disconnect-baseline").tap do |signal|
        ingested_at = 5.minutes.ago
        signal.update_columns(
          occurred_at: ingested_at,
          ingested_at: ingested_at,
        )
      end

      expect(broadcaster).not_to receive(:subscribe)

      signal_write_count = 0

      allow_any_instance_of(Api::SignalsController)
        .to receive(:sse_write)
        .and_wrap_original do |original, stream, event:, data:|
          if event == "signal"
            signal_write_count += 1
            next false if signal_write_count == 1
          end

          original.call(stream, event: event, data: data)
        end

      get "/api/signals/stream",
          params: { token: sse_token, since: 1.hour.ago.iso8601 }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("event: connected")
      expect(response.body).not_to include("event: signal")
    end

    it "deduplicates queue-published signals that overlap with the catchup replay window" do
      baseline_signals = Array.new(3) do |index|
        create(:external_signal, external_id: "baseline-overlap-#{index}").tap do |signal|
          ingested_at = 10.minutes.ago + index.minutes
          signal.update_columns(
            occurred_at: ingested_at,
            ingested_at: ingested_at,
          )
        end
      end

      overlap_signal = nil
      baseline_calls = 0

      allow_any_instance_of(Api::SignalsController)
        .to receive(:stream_signal_baseline)
        .and_wrap_original do |original, *args, **kwargs|
          baseline_calls += 1

          if baseline_calls == 2
            overlap_signal = create(:external_signal, external_id: "overlap-live").tap do |signal|
              signal.update_columns(
                occurred_at: Time.current,
                ingested_at: Time.current,
              )
            end

            queue << Signals::PayloadSerializer.call(overlap_signal).to_json
            queue << nil
          end

          original.call(*args, **kwargs)
        end

      get "/api/signals/stream",
          params: { token: sse_token, since: 6.hours.ago.iso8601 }

      expect(response).to have_http_status(:ok)

      streamed_payloads = response.body
        .scan(/^event: signal\ndata: (.+)$/)
        .flatten
        .map { |payload| JSON.parse(payload) }

      baseline_ids = baseline_signals
        .sort_by { |signal| [signal.ingested_at, signal.id] }
        .map(&:id)

      expect(streamed_payloads.map { |payload| payload.fetch("id") }).to eq([
        *baseline_ids,
        overlap_signal.id,
      ])
    end
  end
end
