require "rails_helper"

RSpec.describe Vessels::LoiteringDetectionJob, type: :job do
  include ActiveSupport::Testing::TimeHelpers

  let(:job) { described_class.new }

  def create_track(vessel, minutes_ago:, lat:, lng:, speed:)
    create(
      :vessel_track,
      vessel: vessel,
      occurred_at: minutes_ago.minutes.ago,
      lat: lat,
      lng: lng,
      speed: speed,
    )
  end

  describe "#perform" do
    it "sets loitering_since when a vessel remains slow within a tight radius for 30 minutes" do
      travel_to(Time.zone.parse("2026-03-27 20:30:00 UTC")) do
        vessel = create(
          :vessel,
          lat: 25.0008,
          lng: 56.0006,
          speed: 0.8,
          last_seen_at: 5.minutes.ago,
          loitering_since: nil,
        )

        create_track(vessel, minutes_ago: 35, lat: 25.0000, lng: 56.0000, speed: 0.7)
        create_track(vessel, minutes_ago: 20, lat: 25.0004, lng: 56.0003, speed: 0.9)
        create_track(vessel, minutes_ago: 10, lat: 25.0006, lng: 56.0005, speed: 0.8)

        job.perform

        expect(vessel.reload.loitering_since).to eq(35.minutes.ago)
      end
    end

    it "does not flag loitering when the vessel drifts outside the loiter radius" do
      travel_to(Time.zone.parse("2026-03-27 20:30:00 UTC")) do
        vessel = create(
          :vessel,
          lat: 25.06,
          lng: 56.06,
          speed: 0.7,
          last_seen_at: 5.minutes.ago,
        )

        create_track(vessel, minutes_ago: 35, lat: 25.0000, lng: 56.0000, speed: 0.7)
        create_track(vessel, minutes_ago: 20, lat: 25.0200, lng: 56.0200, speed: 0.6)
        create_track(vessel, minutes_ago: 10, lat: 25.0400, lng: 56.0400, speed: 0.8)

        job.perform

        expect(vessel.reload.loitering_since).to be_nil
      end
    end

    it "clears loitering_since when a flagged vessel resumes transit speed" do
      travel_to(Time.zone.parse("2026-03-27 20:30:00 UTC")) do
        vessel = create(
          :vessel,
          :loitering,
          lat: 25.0200,
          lng: 56.0200,
          speed: 4.0,
          last_seen_at: 5.minutes.ago,
          loitering_since: 40.minutes.ago,
        )

        create_track(vessel, minutes_ago: 35, lat: 25.0000, lng: 56.0000, speed: 0.7)
        create_track(vessel, minutes_ago: 20, lat: 25.0050, lng: 56.0050, speed: 0.9)
        create_track(vessel, minutes_ago: 10, lat: 25.0100, lng: 56.0100, speed: 1.0)

        job.perform

        expect(vessel.reload.loitering_since).to be_nil
      end
    end

    it "preserves the original loitering_since while the vessel remains loitering" do
      travel_to(Time.zone.parse("2026-03-27 20:30:00 UTC")) do
        original_since = 55.minutes.ago.change(usec: 0)
        vessel = create(
          :vessel,
          :loitering,
          lat: 25.0007,
          lng: 56.0005,
          speed: 0.7,
          last_seen_at: 5.minutes.ago,
          loitering_since: original_since,
        )

        create_track(vessel, minutes_ago: 55, lat: 25.0000, lng: 56.0000, speed: 0.8)
        create_track(vessel, minutes_ago: 35, lat: 25.0002, lng: 56.0001, speed: 0.7)
        create_track(vessel, minutes_ago: 20, lat: 25.0004, lng: 56.0003, speed: 0.8)
        create_track(vessel, minutes_ago: 10, lat: 25.0006, lng: 56.0004, speed: 0.9)

        job.perform

        expect(vessel.reload.loitering_since).to eq(original_since)
      end
    end
  end
end
