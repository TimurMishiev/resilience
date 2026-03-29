require "rails_helper"

RSpec.describe Telemetry::PreparePartitionsJob, type: :job do
  describe "#perform" do
    it "ensures the configured telemetry partition window" do
      reference_time = Time.utc(2026, 3, 24, 12)

      allow(Telemetry::PartitionManager).to receive(:ensure_window!)

      described_class.new.perform(reference_time)

      expect(Telemetry::PartitionManager).to have_received(:ensure_window!).with(
        reference_time,
        days_back: described_class::DAYS_BACK,
        days_ahead: described_class::DAYS_AHEAD
      )
    end

    it "logs at ERROR level and re-raises when partition preparation fails" do
      reference_time = Time.utc(2026, 3, 24, 12)
      allow(Telemetry::PartitionManager).to receive(:ensure_window!).and_raise(RuntimeError, "DDL timeout")

      expect(Rails.logger).to receive(:error).with(a_string_including("CRITICAL", "DDL timeout"))
      expect { described_class.new.perform(reference_time) }.to raise_error(RuntimeError, "DDL timeout")
    end
  end
end
