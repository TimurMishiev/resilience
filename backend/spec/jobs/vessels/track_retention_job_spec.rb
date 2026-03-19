require "rails_helper"

RSpec.describe Vessels::TrackRetentionJob, type: :job do
  describe "#perform" do
    it "deletes tracks older than 7 days and keeps recent ones" do
      old_tracks  = create_list(:vessel_track, 3, occurred_at: 8.days.ago)
      keep_tracks = create_list(:vessel_track, 2, occurred_at: 3.days.ago)

      described_class.new.perform

      old_tracks.each  { |t| expect(VesselTrack.find_by(id: t.id)).to be_nil }
      keep_tracks.each { |t| expect(VesselTrack.find_by(id: t.id)).to be_present }
    end

    it "handles the table being empty without error" do
      expect { described_class.new.perform }.not_to raise_error
    end

    it "deletes in batches without leaving rows behind" do
      # Create more rows than BATCH_SIZE to confirm loop continues
      stub_const("Vessels::TrackRetentionJob::BATCH_SIZE", 2)
      create_list(:vessel_track, 5, occurred_at: 8.days.ago)

      described_class.new.perform

      expect(VesselTrack.count).to eq(0)
    end
  end
end
