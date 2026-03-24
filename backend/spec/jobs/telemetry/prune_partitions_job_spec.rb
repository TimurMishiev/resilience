require "rails_helper"

RSpec.describe Telemetry::PrunePartitionsJob, type: :job do
  describe "#perform" do
    it "prunes telemetry partitions using the default retention window" do
      reference_time = Time.utc(2026, 3, 24, 12)
      retention_days = 45

      allow(Telemetry::PartitionManager).to receive(:default_retention_days).and_return(retention_days)
      allow(Telemetry::PartitionManager).to receive(:prune_expired!)

      described_class.new.perform(reference_time)

      expect(Telemetry::PartitionManager).to have_received(:prune_expired!).with(
        reference_time: reference_time,
        retention_days: retention_days
      )
    end
  end
end
