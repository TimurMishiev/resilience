require "rails_helper"

RSpec.describe Feeds::GpsjamIngestionService, type: :service do
  let(:service) { described_class.new }

  describe "#in_any_theater?" do
    it "returns true for Eastern Europe coordinates" do
      expect(service.send(:in_any_theater?, 48.0, 30.0)).to be true
    end

    it "returns true for Middle East coordinates" do
      expect(service.send(:in_any_theater?, 35.5, 37.2)).to be true
    end

    it "returns true for Horn of Africa coordinates" do
      expect(service.send(:in_any_theater?, 11.5, 42.5)).to be true
    end

    it "returns true for Indo-Pacific coordinates" do
      expect(service.send(:in_any_theater?, 20.0, 105.0)).to be true
    end

    it "returns false for South America" do
      expect(service.send(:in_any_theater?, -15.0, -65.0)).to be false
    end

    it "returns false for Northern Canada" do
      expect(service.send(:in_any_theater?, 70.0, -95.0)).to be false
    end
  end

  describe "#ingest_hexagon (signal creation)" do
    let(:hex_str)      { "841fa4dfffffff" }
    let(:lat)          { 48.5 }
    let(:lng)          { 30.2 }
    let(:signal_level) { 0.75 }

    it "creates an ExternalSignal with signal_type gps_jamming" do
      expect {
        service.send(:ingest_hexagon, hex_str, lat, lng, signal_level)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("gps_jamming")
      expect(signal.source).to eq("gpsjam")
    end

    it "uses hex_str as the external_id" do
      service.send(:ingest_hexagon, hex_str, lat, lng, signal_level)
      expect(ExternalSignal.last.external_id).to eq(hex_str)
    end

    it "stores signal_level and hex_id in raw_payload" do
      service.send(:ingest_hexagon, hex_str, lat, lng, signal_level)
      payload = ExternalSignal.last.raw_payload
      expect(payload["signal_level"]).to eq(signal_level)
      expect(payload["hex_id"]).to eq(hex_str)
    end

    it "deduplicates — same hex_str ingested twice at the same time creates only one record" do
      fixed_time = Time.utc(2024, 1, 1, 12, 0, 0)
      allow(Time).to receive(:current).and_return(fixed_time)
      service.send(:ingest_hexagon, hex_str, lat, lng, signal_level)
      expect {
        service.send(:ingest_hexagon, hex_str, lat, lng, signal_level)
      }.not_to change(ExternalSignal, :count)
    end

    it "returns nil silently on IngestService error" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "db error")
      expect { service.send(:ingest_hexagon, hex_str, lat, lng, signal_level) }.not_to raise_error
    end
  end

  describe "#parse_and_ingest" do
    it "skips rows below MIN_SIGNAL threshold" do
      csv_body = "hex,count_good_aircraft,count_bad_aircraft\n841fa4dfffffff,90,5\n"
      expect {
        service.send(:parse_and_ingest, csv_body, Feeds::PollMetrics.new(feed: "gpsjam"))
      }.not_to change(ExternalSignal, :count)
    end

    it "skips rows with zero total aircraft" do
      csv_body = "hex,count_good_aircraft,count_bad_aircraft\n841fa4dfffffff,0,0\n"
      expect {
        service.send(:parse_and_ingest, csv_body, Feeds::PollMetrics.new(feed: "gpsjam"))
      }.not_to change(ExternalSignal, :count)
    end

    it "skips blank hex values" do
      csv_body = "hex,count_good_aircraft,count_bad_aircraft\n,10,8\n"
      expect {
        service.send(:parse_and_ingest, csv_body, Feeds::PollMetrics.new(feed: "gpsjam"))
      }.not_to change(ExternalSignal, :count)
    end
  end

  describe "#call with no available data" do
    it "returns success with 0 ingested when fetch returns nil" do
      allow(service).to receive(:fetch_csv_for).and_return(nil)
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end

    it "returns success with 0 ingested on network exception" do
      allow(service).to receive(:fetch_csv_for).and_raise(Errno::ECONNREFUSED)
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end
  end
end
