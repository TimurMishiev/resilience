require "rails_helper"

RSpec.describe Vessel, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with required fields" do
      expect(build(:vessel)).to be_valid
    end

    it "requires mmsi" do
      expect(build(:vessel, mmsi: nil)).not_to be_valid
    end

    it "enforces mmsi uniqueness" do
      create(:vessel, mmsi: "123456789")
      expect(build(:vessel, mmsi: "123456789")).not_to be_valid
    end

    it "requires lat and lng" do
      expect(build(:vessel, lat: nil)).not_to be_valid
      expect(build(:vessel, lng: nil)).not_to be_valid
    end

    it "rejects lat out of range" do
      expect(build(:vessel, lat: 91.0)).not_to be_valid
      expect(build(:vessel, lat: -91.0)).not_to be_valid
    end

    it "rejects lng out of range" do
      expect(build(:vessel, lng: 181.0)).not_to be_valid
      expect(build(:vessel, lng: -181.0)).not_to be_valid
    end

    it "requires first_seen_at and last_seen_at" do
      expect(build(:vessel, first_seen_at: nil)).not_to be_valid
      expect(build(:vessel, last_seen_at: nil)).not_to be_valid
    end
  end

  # ── Scopes ───────────────────────────────────────────────────────────────────

  describe ".dark_since" do
    it "returns vessels not seen within the given duration" do
      dark_vessel   = create(:vessel, :dark)            # last_seen 30 min ago
      active_vessel = create(:vessel, last_seen_at: 2.minutes.ago)

      results = Vessel.dark_since(20.minutes)
      expect(results).to include(dark_vessel)
      expect(results).not_to include(active_vessel)
    end
  end

  describe ".loitering" do
    it "returns only vessels with loitering_since set" do
      loitering = create(:vessel, :loitering)
      normal    = create(:vessel)

      expect(Vessel.loitering).to include(loitering)
      expect(Vessel.loitering).not_to include(normal)
    end
  end

  # ── upsert_from_signal! ──────────────────────────────────────────────────────

  describe ".upsert_from_signal!" do
    let(:signal) do
      create(:external_signal, :vessel,
        external_id: "234567890",
        lat:         25.1,
        lng:         56.2,
        speed:       14.0,
        heading:     270,
        occurred_at: Time.current,
        raw_payload: { "callsign" => "ORION", "vessel_type" => "tanker", "flag" => "IR" }
      )
    end

    context "when the vessel does not exist yet" do
      it "creates a new vessel record" do
        expect { Vessel.upsert_from_signal!(signal) }.to change(Vessel, :count).by(1)
      end

      it "returns [vessel, true]" do
        vessel, created = Vessel.upsert_from_signal!(signal)
        expect(created).to be true
        expect(vessel.mmsi).to eq("234567890")
      end

      it "sets first_seen_at from the signal's occurred_at" do
        vessel, = Vessel.upsert_from_signal!(signal)
        expect(vessel.first_seen_at).to be_within(1.second).of(signal.occurred_at)
      end

      it "sets position and identity fields from the signal" do
        vessel, = Vessel.upsert_from_signal!(signal)
        expect(vessel.lat).to eq(25.1)
        expect(vessel.lng).to eq(56.2)
        expect(vessel.name).to eq("ORION")
        expect(vessel.vessel_type).to eq("tanker")
        expect(vessel.flag).to eq("IR")
      end

      it "links last_signal_id to the source signal" do
        vessel, = Vessel.upsert_from_signal!(signal)
        expect(vessel.last_signal_id).to eq(signal.id)
      end
    end

    context "when the vessel already exists" do
      let!(:existing) do
        create(:vessel,
          mmsi:         "234567890",
          first_seen_at: 3.hours.ago,
          last_seen_at:  1.hour.ago
        )
      end

      it "does not create a new record" do
        expect { Vessel.upsert_from_signal!(signal) }.not_to change(Vessel, :count)
      end

      it "returns [vessel, false]" do
        _, created = Vessel.upsert_from_signal!(signal)
        expect(created).to be false
      end

      it "updates position to the new signal" do
        vessel, = Vessel.upsert_from_signal!(signal)
        expect(vessel.lat).to eq(25.1)
        expect(vessel.lng).to eq(56.2)
      end

      it "updates last_seen_at but preserves first_seen_at" do
        original_first_seen = existing.first_seen_at
        vessel, = Vessel.upsert_from_signal!(signal)
        expect(vessel.last_seen_at).to be_within(1.second).of(signal.occurred_at)
        expect(vessel.first_seen_at).to be_within(1.second).of(original_first_seen)
      end
    end
  end

  # ── Instance Methods ─────────────────────────────────────────────────────────

  describe "#dark?" do
    it "returns true when last_seen_at is beyond the threshold" do
      vessel = build(:vessel, last_seen_at: 25.minutes.ago)
      expect(vessel.dark?(since: 20.minutes)).to be true
    end

    it "returns false when last_seen_at is within the threshold" do
      vessel = build(:vessel, last_seen_at: 5.minutes.ago)
      expect(vessel.dark?(since: 20.minutes)).to be false
    end
  end

  describe "#loitering_speed?" do
    it "returns true when speed is below 2 knots" do
      expect(build(:vessel, speed: 1.5).loitering_speed?).to be true
    end

    it "returns false when speed is at or above 2 knots" do
      expect(build(:vessel, speed: 2.0).loitering_speed?).to be false
      expect(build(:vessel, speed: 12.0).loitering_speed?).to be false
    end

    it "returns false when speed is nil" do
      expect(build(:vessel, speed: nil).loitering_speed?).to be false
    end
  end
end
