require "rails_helper"

RSpec.describe Feeds::AcledIngestionService, type: :service do
  # Tests call the private #ingest_event method directly to avoid requiring
  # live ACLED API credentials and network access.
  # Theater-box filtering, deduplication, and magnitude mapping are all tested.

  let(:service) { described_class.new }

  # Minimal ACLED event record (mirrors the real API response shape)
  let(:raw_event) do
    {
      "event_id_cnty" => "SYR12345",
      "event_date"    => "2026-03-18",
      "event_type"    => "Explosions/Remote violence",
      "sub_event_type" => "Air/drone strike",
      "actor1"        => "Military Forces of Syria",
      "actor2"        => "",
      "country"       => "Syria",
      "latitude"      => "35.5",
      "longitude"     => "37.2",
      "fatalities"    => "3",
      "notes"         => "An airstrike targeted a residential area."
    }
  end

  describe "#ingest_event (signal creation)" do
    it "creates an ExternalSignal with signal_type conflict_event" do
      expect {
        service.send(:ingest_event, raw_event, 35.5, 37.2)
      }.to change(ExternalSignal, :count).by(1)

      signal = ExternalSignal.last
      expect(signal.signal_type).to eq("conflict_event")
      expect(signal.source).to eq("acled")
    end

    it "uses event_id_cnty as the external_id" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.external_id).to eq("SYR12345")
    end

    it "stores fatalities as magnitude" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.magnitude.to_f).to eq(3.0)
    end

    it "sets magnitude to nil when fatalities is zero" do
      zero_event = raw_event.merge("fatalities" => "0")
      service.send(:ingest_event, zero_event, 35.5, 37.2)
      expect(ExternalSignal.last.magnitude).to be_nil
    end

    it "stores raw payload with event_type, actor1, country, notes" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      payload = ExternalSignal.last.raw_payload
      expect(payload["event_type"]).to eq("Explosions/Remote violence")
      expect(payload["actor1"]).to eq("Military Forces of Syria")
      expect(payload["country"]).to eq("Syria")
      expect(payload["fatalities"]).to eq(3)
    end

    it "truncates notes to 500 characters" do
      long_event = raw_event.merge("notes" => "x" * 600)
      service.send(:ingest_event, long_event, 35.5, 37.2)
      expect(ExternalSignal.last.raw_payload["notes"].length).to be <= 500
    end

    it "deduplicates — second call with same event_id_cnty does not create a new record" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect {
        service.send(:ingest_event, raw_event, 35.5, 37.2)
      }.not_to change(ExternalSignal, :count)
    end

    it "falls back to a coordinate-based external_id when event_id_cnty is absent" do
      no_id_event = raw_event.except("event_id_cnty")
      service.send(:ingest_event, no_id_event, 35.5, 37.2)
      signal = ExternalSignal.last
      expect(signal).to be_present
      expect(signal.external_id).to include("2026-03-18")
    end

    it "parses event_date into a noon UTC timestamp" do
      service.send(:ingest_event, raw_event, 35.5, 37.2)
      expect(ExternalSignal.last.occurred_at.hour).to eq(12)
      expect(ExternalSignal.last.occurred_at.utc?).to be true
    end

    it "returns nil silently on error without raising" do
      allow(Signals::IngestService).to receive(:call).and_raise(RuntimeError, "network error")
      expect { service.send(:ingest_event, raw_event, 35.5, 37.2) }.not_to raise_error
    end
  end

  describe "#in_any_theater?" do
    it "returns true for Middle East coordinates" do
      expect(service.send(:in_any_theater?, 35.5, 37.2)).to be true
    end

    it "returns true for Horn of Africa coordinates" do
      expect(service.send(:in_any_theater?, 11.5, 42.5)).to be true
    end

    it "returns true for Eastern Europe coordinates" do
      expect(service.send(:in_any_theater?, 48.0, 30.0)).to be true
    end

    it "returns true for Indo-Pacific coordinates" do
      expect(service.send(:in_any_theater?, 20.0, 105.0)).to be true
    end

    it "returns false for coordinates outside all theater boxes (e.g. South America)" do
      expect(service.send(:in_any_theater?, -15.0, -65.0)).to be false
    end

    it "returns false for coordinates outside all theater boxes (e.g. Northern Canada)" do
      expect(service.send(:in_any_theater?, 70.0, -95.0)).to be false
    end
  end

  describe "#call with missing credentials" do
    # In CI / test environment neither ACLED_API_KEY nor ACLED_EMAIL is set,
    # so the credential guard fires and the service short-circuits gracefully.
    it "returns success with 0 ingested when credentials are absent" do
      # Ensure neither var is set for this test
      saved_key   = ENV.delete("ACLED_API_KEY")
      saved_email = ENV.delete("ACLED_EMAIL")

      begin
        result = described_class.call
        expect(result.success).to be true
        expect(result.payload[:ingested]).to eq(0)
      ensure
        ENV["ACLED_API_KEY"]  = saved_key   if saved_key
        ENV["ACLED_EMAIL"]    = saved_email if saved_email
      end
    end

    it "returns success with 0 ingested when only ACLED_EMAIL is absent" do
      saved_email = ENV.delete("ACLED_EMAIL")
      saved_key   = ENV["ACLED_API_KEY"]
      ENV["ACLED_API_KEY"] = "test-key-placeholder"

      begin
        result = described_class.call
        expect(result.success).to be true
        expect(result.payload[:ingested]).to eq(0)
      ensure
        saved_key ? ENV["ACLED_API_KEY"] = saved_key : ENV.delete("ACLED_API_KEY")
        ENV["ACLED_EMAIL"] = saved_email if saved_email
      end
    end
  end
end
