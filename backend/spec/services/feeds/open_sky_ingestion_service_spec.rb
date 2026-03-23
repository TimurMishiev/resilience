require "rails_helper"

RSpec.describe Feeds::OpenSkyIngestionService, type: :service do
  let(:service) { described_class.new }

  # Minimal OpenSky state vector: [icao24, callsign, country, time_pos, last_contact,
  #   lng, lat, geo_alt, on_ground, velocity, heading, vert_rate, sensors, baro_alt]
  let(:raw_state) do
    [
      "abc123",           # 0  icao24
      "SWR100 ",          # 1  callsign (trailing space)
      "Switzerland",      # 2  origin_country
      1_700_000_000,      # 3  time_position (unix s)
      1_700_000_005,      # 4  last_contact
      37.2,               # 5  longitude
      35.5,               # 6  latitude
      10_500.0,           # 7  geo_altitude
      false,              # 8  on_ground
      250.0,              # 9  velocity m/s
      90.0,               # 10 true_track
      0.0,                # 11 vertical_rate
      nil,                # 12 sensors
      10_400.0            # 13 baro_altitude
    ]
  end

  let(:server_time) { 1_700_000_010 }

  describe "#ingest_state (signal creation)" do
    it "creates an ExternalSignal with signal_type aircraft_position" do
      expect {
        service.send(:ingest_state, raw_state, server_time)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("aircraft_position")
      expect(signal.source).to eq("opensky")
    end

    it "uses icao24 as the external_id" do
      service.send(:ingest_state, raw_state, server_time)
      expect(ExternalSignal.last.external_id).to eq("abc123")
    end

    it "maps lat/lng from state indices 6 and 5" do
      service.send(:ingest_state, raw_state, server_time)
      signal = ExternalSignal.last
      expect(signal.lat.to_f).to be_within(0.001).of(35.5)
      expect(signal.lng.to_f).to be_within(0.001).of(37.2)
    end

    it "stores speed and heading" do
      service.send(:ingest_state, raw_state, server_time)
      signal = ExternalSignal.last
      expect(signal.speed.to_f).to eq(250.0)
      expect(signal.heading.to_f).to eq(90.0)
    end

    it "strips trailing spaces from callsign in raw_payload" do
      service.send(:ingest_state, raw_state, server_time)
      expect(ExternalSignal.last.raw_payload["callsign"]).to eq("SWR100")
    end

    it "uses time_position (index 3) as occurred_at when present" do
      service.send(:ingest_state, raw_state, server_time)
      expect(ExternalSignal.last.occurred_at).to be_within(1.second).of(Time.at(1_700_000_000))
    end

    it "falls back to server_time when time_position is nil" do
      state = raw_state.dup
      state[3] = nil
      state[4] = nil
      service.send(:ingest_state, state, server_time)
      expect(ExternalSignal.last.occurred_at).to be_within(1.second).of(Time.at(server_time))
    end

    it "deduplicates — same icao24 at same time creates only one record" do
      service.send(:ingest_state, raw_state, server_time)
      expect {
        service.send(:ingest_state, raw_state, server_time)
      }.not_to change(ExternalSignal, :count)
    end

    it "returns nil when lat is missing" do
      state = raw_state.dup
      state[6] = nil
      result = service.send(:ingest_state, state, server_time)
      expect(result).to be_nil
    end

    it "returns nil when lng is missing" do
      state = raw_state.dup
      state[5] = nil
      result = service.send(:ingest_state, state, server_time)
      expect(result).to be_nil
    end

    it "returns nil silently when time_position is zero" do
      state = raw_state.dup
      state[3] = 0
      state[4] = 0
      result = service.send(:ingest_state, state, server_time)
      expect(result).to be_nil
    end

    it "returns nil silently on IngestService error" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "db error")
      expect { service.send(:ingest_state, raw_state, server_time) }.not_to raise_error
    end
  end

  describe "#call — no credentials" do
    it "returns success even when fetch_box returns nil for all boxes" do
      allow(service).to receive(:fetch_box).and_return(nil)
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end
  end
end
