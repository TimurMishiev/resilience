require "rails_helper"

RSpec.describe Feeds::UsgsSeismicIngestionService, type: :service do
  let(:service) { described_class.new }

  # Minimal GeoJSON feature mirroring the real USGS API shape
  let(:raw_feature) do
    {
      "id"         => "us7000lmgb",
      "properties" => {
        "mag"     => 4.5,
        "place"   => "10km NE of Somewhere",
        "time"    => 1_700_000_000_000,  # Unix ms
        "magType" => "ml",
        "alert"   => nil,
        "tsunami" => 0
      },
      "geometry" => {
        "coordinates" => [37.2, 35.5, 10.0]  # [lng, lat, depth_km]
      }
    }
  end

  describe "#ingest_feature (signal creation)" do
    it "creates an ExternalSignal with signal_type seismic_event" do
      expect {
        service.send(:ingest_feature, raw_feature)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("seismic_event")
      expect(signal.source).to eq("usgs_seismic")
    end

    it "uses the USGS event id as external_id" do
      service.send(:ingest_feature, raw_feature)
      expect(ExternalSignal.last.external_id).to eq("us7000lmgb")
    end

    it "maps coordinates correctly — GeoJSON is [lng, lat, depth]" do
      service.send(:ingest_feature, raw_feature)
      signal = ExternalSignal.last
      expect(signal.lat.to_f).to be_within(0.001).of(35.5)
      expect(signal.lng.to_f).to be_within(0.001).of(37.2)
    end

    it "stores magnitude from the mag property" do
      service.send(:ingest_feature, raw_feature)
      expect(ExternalSignal.last.magnitude.to_f).to eq(4.5)
    end

    it "converts Unix milliseconds to a UTC timestamp" do
      service.send(:ingest_feature, raw_feature)
      signal = ExternalSignal.last
      expect(signal.occurred_at).to be_within(1.second).of(Time.at(1_700_000_000))
      expect(signal.occurred_at.utc?).to be true
    end

    it "stores raw payload with mag, place, depth, mag_type, alert, tsunami" do
      service.send(:ingest_feature, raw_feature)
      payload = ExternalSignal.last.raw_payload
      expect(payload["mag"]).to eq(4.5)
      expect(payload["place"]).to eq("10km NE of Somewhere")
      expect(payload["depth_km"]).to eq(10.0)
      expect(payload["mag_type"]).to eq("ml")
    end

    it "deduplicates — second call with same event id creates no new record" do
      service.send(:ingest_feature, raw_feature)
      expect {
        service.send(:ingest_feature, raw_feature)
      }.not_to change(ExternalSignal, :count)
    end

    it "returns nil silently when coordinates are missing" do
      bad = raw_feature.merge("geometry" => nil)
      expect { service.send(:ingest_feature, bad) }.not_to raise_error
      expect(service.send(:ingest_feature, bad)).to be_nil
    end

    it "returns nil silently when mag is missing" do
      bad = raw_feature.merge("properties" => raw_feature["properties"].merge("mag" => nil))
      expect { service.send(:ingest_feature, bad) }.not_to raise_error
    end

    it "returns nil silently on IngestService error" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "db error")
      expect { service.send(:ingest_feature, raw_feature) }.not_to raise_error
    end
  end

  describe "#call with no network" do
    it "returns failure when the HTTP request fails" do
      allow_any_instance_of(Net::HTTP).to receive(:get).and_raise(Errno::ECONNREFUSED)
      result = described_class.call
      expect(result.success).to be false
    end
  end
end
