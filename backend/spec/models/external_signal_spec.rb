require "rails_helper"

RSpec.describe ExternalSignal, type: :model do
  subject(:signal) { build(:external_signal) }

  # ── Validations ────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(signal).to be_valid
    end

    it "requires source" do
      signal.source = nil
      expect(signal).not_to be_valid
      expect(signal.errors[:source]).to be_present
    end

    it "rejects invalid source" do
      signal.source = "imaginary_feed"
      expect(signal).not_to be_valid
      expect(signal.errors[:source]).to include(a_string_matching(/is not included/))
    end

    it "requires signal_type" do
      signal.signal_type = nil
      expect(signal).not_to be_valid
      expect(signal.errors[:signal_type]).to be_present
    end

    it "rejects invalid signal_type" do
      signal.signal_type = "unknown_event"
      expect(signal).not_to be_valid
    end

    it "requires external_id" do
      signal.external_id = nil
      expect(signal).not_to be_valid
    end

    it "requires lat" do
      signal.lat = nil
      expect(signal).not_to be_valid
    end

    it "rejects lat out of range" do
      signal.lat = 91
      expect(signal).not_to be_valid

      signal.lat = -91
      expect(signal).not_to be_valid
    end

    it "requires lng" do
      signal.lng = nil
      expect(signal).not_to be_valid
    end

    it "rejects lng out of range" do
      signal.lng = 181
      expect(signal).not_to be_valid

      signal.lng = -181
      expect(signal).not_to be_valid
    end

    it "requires occurred_at" do
      signal.occurred_at = nil
      expect(signal).not_to be_valid
    end
  end

  # ── Constants ──────────────────────────────────────────────────────────────

  describe "SOURCES" do
    it "includes all known feed sources" do
      expect(ExternalSignal::SOURCES).to include("opensky", "ais", "usgs_seismic", "manual", "derived")
    end
  end

  describe "SIGNAL_TYPES" do
    it "includes all known signal types" do
      expect(ExternalSignal::SIGNAL_TYPES).to include("aircraft_position", "vessel_position", "seismic_event", "manual")
    end
  end

  # ── Scopes ─────────────────────────────────────────────────────────────────

  describe ".recent" do
    it "returns signals within the given window" do
      recent = create(:external_signal, occurred_at: 10.minutes.ago)
      old    = create(:external_signal, occurred_at: 2.hours.ago)

      expect(ExternalSignal.recent(60)).to include(recent)
      expect(ExternalSignal.recent(60)).not_to include(old)
    end

    it "defaults to 60 minutes" do
      recent = create(:external_signal, occurred_at: 30.minutes.ago)
      old    = create(:external_signal, occurred_at: 90.minutes.ago)

      result = ExternalSignal.recent
      expect(result).to include(recent)
      expect(result).not_to include(old)
    end
  end

  describe ".by_source" do
    it "filters by source" do
      seismic  = create(:external_signal, source: "usgs_seismic", signal_type: "seismic_event")
      aircraft = create(:external_signal, :aircraft)

      expect(ExternalSignal.by_source("usgs_seismic")).to include(seismic)
      expect(ExternalSignal.by_source("usgs_seismic")).not_to include(aircraft)
    end
  end

  describe ".by_type" do
    it "filters by signal_type" do
      seismic  = create(:external_signal, signal_type: "seismic_event")
      aircraft = create(:external_signal, :aircraft)

      expect(ExternalSignal.by_type("seismic_event")).to include(seismic)
      expect(ExternalSignal.by_type("seismic_event")).not_to include(aircraft)
    end
  end

  describe ".near_point" do
    let!(:close_signal) { create(:external_signal, lat: 51.5, lng: 0.0) }
    let!(:far_signal)   { create(:external_signal, lat: 40.0, lng: -74.0) }

    it "returns signals within the given radius" do
      result = ExternalSignal.near_point(51.5, 0.0, 50)
      expect(result).to include(close_signal)
      expect(result).not_to include(far_signal)
    end

    it "returns empty when nothing is within range" do
      result = ExternalSignal.near_point(0.0, 0.0, 10)
      expect(result).to be_empty
    end
  end

  # ── Associations ───────────────────────────────────────────────────────────

  describe "associations" do
    it "has many signal_rule_matches" do
      persisted = create(:external_signal)
      expect(persisted).to respond_to(:signal_rule_matches)
    end
  end
end
