require "rails_helper"

RSpec.describe Telemetry::PreparePartitionsJob, type: :job do
  describe "#perform" do
    before do
      allow(OperationalStatus).to receive(:record!)
    end

    it "ensures the configured telemetry partition window" do
      reference_time = Time.utc(2026, 3, 24, 12)

      allow(Telemetry::PartitionManager).to receive(:ensure_window!)

      described_class.new.perform(reference_time)

      expect(Telemetry::PartitionManager).to have_received(:ensure_window!).with(
        reference_time,
        days_back: described_class::DAYS_BACK,
        days_ahead: described_class::DAYS_AHEAD
      )
      expect(OperationalStatus).to have_received(:record!).with(
        category: "job_health",
        key: "telemetry_partitions",
        payload: include(status: "ok", reference_time: reference_time.utc.iso8601)
      )
    end

    it "logs at ERROR level and re-raises when partition preparation fails" do
      reference_time = Time.utc(2026, 3, 24, 12)
      allow(Telemetry::PartitionManager).to receive(:ensure_window!).and_raise(RuntimeError, "DDL timeout")

      expect(Rails.logger).to receive(:error).with(a_string_including("CRITICAL", "DDL timeout"))
      expect { described_class.new.perform(reference_time) }.to raise_error(RuntimeError, "DDL timeout")
      expect(OperationalStatus).to have_received(:record!).with(
        category: "job_health",
        key: "telemetry_partitions",
        payload: include(status: "error", last_error_class: "RuntimeError", last_error_message: "DDL timeout")
      )
    end
  end
end
