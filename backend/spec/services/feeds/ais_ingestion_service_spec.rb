require "rails_helper"

RSpec.describe Feeds::AisIngestionService, type: :service do
  # We test the vessel upsert wiring in isolation — not the HTTP fetch.
  # The private #ingest_vessel method is the unit under test here.
  # We call it directly via send() to avoid needing a live AIS Hub API.

  let(:service) { described_class.new }

  # Minimal AIS Hub vessel record (mirrors the real API response shape)
  let(:raw_vessel) do
    {
      "MMSI"      => "123456789",
      "LATITUDE"  => 25.1,
      "LONGITUDE" => 56.2,
      "TIME"      => "2026-03-18 10:00:00",
      "SOG"       => 12.0,
      "HEADING"   => 180,
      "NAME"      => "MV ORION",
      "CALLSIGN"  => "ABCD1",
      "TYPE"      => "80",
      "DEST"      => "DUBAI",
      "COG"       => 182.0,
      "NAVSTAT"   => 0
    }
  end

  describe "#ingest_vessel (vessel upsert wiring)" do
    it "creates a Vessel record after ingesting the signal" do
      expect {
        service.send(:ingest_vessel, raw_vessel)
      }.to change(Vessel, :count).by(1)
    end

    it "sets the vessel's MMSI from the AIS record" do
      service.send(:ingest_vessel, raw_vessel)
      vessel = Vessel.find_by(mmsi: "123456789")
      expect(vessel).to be_present
      expect(vessel.name).to eq("MV ORION")
    end

    it "sets destination from the 'dest' key in raw_payload" do
      service.send(:ingest_vessel, raw_vessel)
      vessel = Vessel.find_by(mmsi: "123456789")
      expect(vessel.destination).to eq("DUBAI")
    end

    it "updates an existing vessel on a subsequent ping" do
      # First ping
      service.send(:ingest_vessel, raw_vessel)

      # Second ping — same vessel, new position
      updated = raw_vessel.merge(
        "LATITUDE"  => 25.9,
        "LONGITUDE" => 56.8,
        "TIME"      => "2026-03-18 10:30:00"
      )

      expect {
        service.send(:ingest_vessel, updated)
      }.not_to change(Vessel, :count)

      vessel = Vessel.find_by(mmsi: "123456789")
      expect(vessel.lat).to eq(25.9)
      expect(vessel.lng).to eq(56.8)
    end

    it "preserves first_seen_at across updates" do
      service.send(:ingest_vessel, raw_vessel)
      original_first_seen = Vessel.find_by(mmsi: "123456789").first_seen_at

      updated = raw_vessel.merge("TIME" => "2026-03-18 11:00:00")
      service.send(:ingest_vessel, updated)

      expect(Vessel.find_by(mmsi: "123456789").first_seen_at)
        .to be_within(1.second).of(original_first_seen)
    end

    it "returns nil silently when required fields are missing" do
      bad = raw_vessel.except("MMSI")
      expect(service.send(:ingest_vessel, bad)).to be_nil
      expect(Vessel.count).to eq(0)
    end
  end
end
