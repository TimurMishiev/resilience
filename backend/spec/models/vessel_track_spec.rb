require "rails_helper"

RSpec.describe VesselTrack, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with required fields" do
      expect(build(:vessel_track)).to be_valid
    end

    it "requires occurred_at" do
      expect(build(:vessel_track, occurred_at: nil)).not_to be_valid
    end

    it "requires lat and lng" do
      expect(build(:vessel_track, lat: nil)).not_to be_valid
      expect(build(:vessel_track, lng: nil)).not_to be_valid
    end
  end

  # ── Immutability ─────────────────────────────────────────────────────────────

  describe "immutability" do
    it "cannot be updated after creation" do
      track = create(:vessel_track)
      expect(track.update(speed: 99.0)).to be false
      expect(track.reload.speed).not_to eq(99.0)
    end
  end

  # ── Scopes ───────────────────────────────────────────────────────────────────

  describe ".between" do
    it "returns tracks within the given time range in order" do
      vessel = create(:vessel)
      t1 = create(:vessel_track, vessel: vessel, occurred_at: 3.hours.ago)
      t2 = create(:vessel_track, vessel: vessel, occurred_at: 2.hours.ago)
      t3 = create(:vessel_track, vessel: vessel, occurred_at: 30.minutes.ago)

      results = VesselTrack.where(vessel: vessel).between(4.hours.ago, 1.hour.ago)
      expect(results).to eq([ t1, t2 ])
      expect(results).not_to include(t3)
    end
  end

  describe ".older_than" do
    it "returns only rows beyond the retention window" do
      old_track  = create(:vessel_track, occurred_at: 8.days.ago)
      new_track  = create(:vessel_track, occurred_at: 3.days.ago)

      results = VesselTrack.older_than(7.days)
      expect(results).to include(old_track)
      expect(results).not_to include(new_track)
    end
  end
end
