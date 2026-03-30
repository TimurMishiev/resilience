require "rails_helper"

RSpec.describe Telemetry::SimulatorService do
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
      allow(Telemetry::PartitionManager).to receive(:ensure_window!)

      service.send(:persist!, rows, occurred_at)

      expect(Telemetry::PartitionManager).to have_received(:ensure_window!).with(occurred_at)
    end
  end
end
