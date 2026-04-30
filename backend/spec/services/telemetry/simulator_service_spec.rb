require "rails_helper"

RSpec.describe Telemetry::SimulatorService do
  around do |example|
    original = ENV[described_class::ENABLED_ENV]
    ENV.delete(described_class::ENABLED_ENV)
    example.run
    if original.nil?
      ENV.delete(described_class::ENABLED_ENV)
    else
      ENV[described_class::ENABLED_ENV] = original
    end
  end

  describe ".enabled?" do
    it "is disabled by default" do
      expect(described_class.enabled?).to be(false)
    end

    it "accepts explicit true values" do
      ENV[described_class::ENABLED_ENV] = "true"
      expect(described_class.enabled?).to be(true)
    end

    it "treats false-like values as disabled" do
      ENV[described_class::ENABLED_ENV] = "false"
      expect(described_class.enabled?).to be(false)
    end
  end

  describe ".boot!" do
    let(:logger) { instance_double(Logger, info: nil) }

    it "does not start when the simulator is disabled" do
      allow(described_class).to receive(:start!)

      expect(described_class.boot!(logger: logger)).to be(false)
      expect(described_class).not_to have_received(:start!)
    end

    it "does not start outside the server process" do
      ENV[described_class::ENABLED_ENV] = "true"
      allow(described_class).to receive(:server_process?).and_return(false)
      allow(described_class).to receive(:start!)

      expect(described_class.boot!(logger: logger)).to be(false)
      expect(described_class).not_to have_received(:start!)
    end

    it "starts only when explicitly enabled in a server process" do
      ENV[described_class::ENABLED_ENV] = "true"
      allow(described_class).to receive(:server_process?).and_return(true)
      allow(described_class).to receive(:start!)

      expect(described_class.boot!(logger: logger)).to be(true)
      expect(described_class).to have_received(:start!)
    end
  end

  describe "#tick" do
    let(:service) { described_class.new }

    it "publishes telemetry even when the local process has no direct subscribers" do
      state = described_class::AssetState.new(
        id: SecureRandom.uuid,
        name: "Asset Alpha",
        asset_type: "vehicle",
        lat: 1.0,
        lng: 2.0,
        heading: 90.0,
        speed: 5.0,
        battery: 80.0,
      )

      service.instance_variable_set(:@state, [state])
      allow(service).to receive(:persist!)
      allow(Telemetry::Broadcaster.instance).to receive(:publish)

      service.send(:tick)

      expect(Telemetry::Broadcaster.instance).to have_received(:publish).at_least(:once)
    end
  end

  describe "#persist!" do
    let(:service) { described_class.new }
    let(:site) { create(:site) }
    let!(:asset) { create(:asset, home_site: site) }
    let(:occurred_at) { Time.current.change(usec: 0) }
    let(:rows) do
      [
        {
          asset_id: asset.id,
          name: asset.name,
          lat: 37.7749,
          lng: -122.4194,
          heading: 90.0,
          speed: 5.5,
          battery: 82.0,
          occurred_at: occurred_at,
        }
      ]
    end

    it "ensures the required telemetry partition before bulk insert" do
      # Spy with .and_call_original so the real partition creation runs;
      # otherwise the subsequent insert_all! fails with "no partition of
      # relation telemetry_readings found for row" because the stub
      # neutralised the partition-ensurance step.
      allow(Telemetry::PartitionManager).to receive(:ensure_window!).and_call_original

      service.send(:persist!, rows, occurred_at)

      expect(Telemetry::PartitionManager).to have_received(:ensure_window!).with(occurred_at)
    end
  end
end
