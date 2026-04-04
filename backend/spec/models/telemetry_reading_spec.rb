require "rails_helper"

RSpec.describe TelemetryReading, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:telemetry_reading)).to be_valid
    end

    it "requires lat" do
      expect(build(:telemetry_reading, lat: nil)).not_to be_valid
    end

    it "requires lng" do
      expect(build(:telemetry_reading, lng: nil)).not_to be_valid
    end

    it "requires occurred_at" do
      expect(build(:telemetry_reading, occurred_at: nil)).not_to be_valid
    end

    it "rejects lat below -90" do
      expect(build(:telemetry_reading, lat: -91)).not_to be_valid
    end

    it "rejects lat above 90" do
      expect(build(:telemetry_reading, lat: 91)).not_to be_valid
    end

    it "rejects lng below -180" do
      expect(build(:telemetry_reading, lng: -181)).not_to be_valid
    end

    it "rejects lng above 180" do
      expect(build(:telemetry_reading, lng: 181)).not_to be_valid
    end

    it "accepts boundary lat values" do
      expect(build(:telemetry_reading, lat: -90)).to be_valid
      expect(build(:telemetry_reading, lat: 90)).to be_valid
    end

    it "accepts boundary lng values" do
      expect(build(:telemetry_reading, lng: -180)).to be_valid
      expect(build(:telemetry_reading, lng: 180)).to be_valid
    end
  end
end
