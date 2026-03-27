require "rails_helper"

RSpec.describe Feeds::FirmsWildfireIngestionService, type: :service do
  let(:service) { described_class.new }

  # Minimal FIRMS VIIRS_SNPP_NRT CSV row as a hash (CSV::Row-like)
  let(:raw_row) do
    {
      "latitude"   => "35.5123",
      "longitude"  => "37.2456",
      "bright_ti4" => "310.5",
      "bright_ti5" => "295.2",
      "scan"       => "0.4",
      "track"      => "0.4",
      "acq_date"   => "2023-11-14",
      "acq_time"   => "0735",
      "satellite"  => "N",
      "instrument" => "VIIRS",
      "confidence" => "h",
      "version"    => "2.0NRT",
      "frp"        => "12.5",
      "daynight"   => "D"
    }
  end

  describe "#ingest_row (signal creation)" do
    it "creates an ExternalSignal with signal_type wildfire" do
      expect {
        service.send(:ingest_row, raw_row)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("wildfire")
      expect(signal.source).to eq("firms_wildfire")
    end

    it "maps lat and lng from the row" do
      service.send(:ingest_row, raw_row)
      signal = ExternalSignal.last
      expect(signal.lat.to_f).to be_within(0.001).of(35.5123)
      expect(signal.lng.to_f).to be_within(0.001).of(37.2456)
    end

    it "uses FRP as magnitude" do
      service.send(:ingest_row, raw_row)
      expect(ExternalSignal.last.magnitude.to_f).to eq(12.5)
    end

    it "builds a stable composite external_id from date, time, and rounded lat/lng" do
      service.send(:ingest_row, raw_row)
      expected_id = "2023-11-14_0735_#{35.5123.round(4)}_#{37.2456.round(4)}"
      expect(ExternalSignal.last.external_id).to eq(expected_id)
    end

    it "parses acq_date + acq_time into occurred_at UTC" do
      service.send(:ingest_row, raw_row)
      expect(ExternalSignal.last.occurred_at).to be_within(1.second).of(
        Time.utc(2023, 11, 14, 7, 35, 0)
      )
    end

    it "stores frp, confidence, satellite in raw_payload" do
      service.send(:ingest_row, raw_row)
      payload = ExternalSignal.last.raw_payload
      expect(payload["frp"]).to eq(12.5)
      expect(payload["confidence"]).to eq("h")
      expect(payload["satellite"]).to eq("N")
    end

    it "deduplicates — same row ingested twice creates only one record" do
      service.send(:ingest_row, raw_row)
      expect {
        service.send(:ingest_row, raw_row)
      }.not_to change(ExternalSignal, :count)
    end

    it "skips low-confidence rows (confidence = 'l')" do
      low_conf = raw_row.merge("confidence" => "l")
      result = service.send(:ingest_row, low_conf)
      expect(result).to be_nil
      expect(ExternalSignal.count).to eq(0)
    end

    it "skips uppercase low-confidence rows (confidence = 'L')" do
      low_conf = raw_row.merge("confidence" => "L")

      result = service.send(:ingest_row, low_conf)

      expect(result).to be_nil
      expect(ExternalSignal.count).to eq(0)
    end

    it "accepts nominal-confidence rows (confidence = 'n')" do
      nominal = raw_row.merge("confidence" => "n")
      expect {
        service.send(:ingest_row, nominal)
      }.to change(ExternalSignal, :count).by(1)
    end

    it "accepts uppercase nominal-confidence rows (confidence = 'N')" do
      nominal = raw_row.merge("confidence" => "N")

      expect {
        service.send(:ingest_row, nominal)
      }.to change(ExternalSignal, :count).by(1)
    end

    it "returns nil when latitude is missing" do
      row = raw_row.merge("latitude" => nil)
      expect(service.send(:ingest_row, row)).to be_nil
    end

    it "returns nil when acq_date is missing" do
      row = raw_row.merge("acq_date" => nil)
      expect(service.send(:ingest_row, row)).to be_nil
    end

    it "returns nil silently on IngestService error" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "db error")
      expect { service.send(:ingest_row, raw_row) }.not_to raise_error
    end
  end

  describe "#call — no API key" do
    it "returns failure when NASA_FIRMS_MAP_KEY is not set" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("NASA_FIRMS_MAP_KEY").and_return(nil)
      result = service.call
      expect(result.success).to be false
      expect(result.errors).to include(a_string_matching(/NASA_FIRMS_MAP_KEY/))
    end
  end

  describe "#call — no available data" do
    before do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("NASA_FIRMS_MAP_KEY").and_return("fake_key")
      allow(service).to receive(:fetch_box).and_return(nil)
    end

    it "returns success with 0 ingested when all boxes return nil" do
      result = service.call
      expect(result.success).to be true
      expect(result.payload[:ingested]).to eq(0)
    end
  end
end
