require "rails_helper"

RSpec.describe Correlations::EvaluateRecentJob, type: :job do
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Rails.logger).to receive(:info)
  end

  describe "#perform" do
    let(:site) do
      Site.create!(
        name: "Alpha Base",
        latitude: 51.5,
        longitude: -0.1,
        geofence_radius_km: 50,
        status: "active"
      )
    end

    it "dispatches to EvaluatorService and GeofenceBreachService for recent signals" do
      signal = ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: "test-eq-1",
        lat: 51.6,
        lng: 0.0,
        occurred_at: 5.seconds.ago,
        ingested_at: 5.seconds.ago,
        raw_payload: {}
      )
      site # ensure site exists

      expect(Correlations::EvaluatorService).to receive(:call).with(signal: having_attributes(id: signal.id))
      expect(Sites::GeofenceBreachService).to receive(:call).with(
        signal: having_attributes(id: signal.id),
        sites: array_including(having_attributes(id: site.id))
      )

      described_class.new.perform
    end

    it "skips signals outside the evaluation window" do
      ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: "old-eq-1",
        lat: 51.6,
        lng: 0.0,
        occurred_at: 1.hour.ago,
        ingested_at: 1.hour.ago,
        raw_payload: {}
      )

      expect(Correlations::EvaluatorService).not_to receive(:call)
      expect(Sites::GeofenceBreachService).not_to receive(:call)

      described_class.new.perform
    end

    it "logs count when signals are evaluated" do
      ExternalSignal.create!(
        source: "opensky",
        signal_type: "aircraft_position",
        external_id: "ac-1",
        lat: 51.5,
        lng: -0.1,
        occurred_at: 2.seconds.ago,
        ingested_at: 2.seconds.ago,
        raw_payload: {}
      )

      allow(Correlations::EvaluatorService).to receive(:call)
      allow(Sites::GeofenceBreachService).to receive(:call)

      expect(Rails.logger).to receive(:info).with(/evaluated=1/)

      described_class.new.perform
    end

    it "does not log when no signals are in the window" do
      expect(Rails.logger).not_to receive(:info).with(/evaluated=/)

      described_class.new.perform
    end

    it "only loads active sites with a geofence radius" do
      no_fence = Site.new(
        name: "No Fence",
        latitude: 40.0,
        longitude: -74.0,
        geofence_radius_km: 0.001,
        status: "active"
      )
      no_fence.save!(validate: false)
      # Force geofence_radius_km to 0 to bypass validation (testing query filter)
      no_fence.update_column(:geofence_radius_km, 0)
      Site.create!(
        name: "Inactive",
        latitude: 40.0,
        longitude: -74.0,
        geofence_radius_km: 100,
        status: "inactive"
      )
      active_fenced = Site.create!(
        name: "Fenced Active",
        latitude: 40.0,
        longitude: -74.0,
        geofence_radius_km: 25,
        status: "active"
      )

      signal = ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: "eq-fence-test",
        lat: 40.0,
        lng: -74.0,
        occurred_at: 1.second.ago,
        ingested_at: 1.second.ago,
        raw_payload: {}
      )

      allow(Correlations::EvaluatorService).to receive(:call)
      expect(Sites::GeofenceBreachService).to receive(:call) do |args|
        site_ids = args[:sites].map(&:id)
        expect(site_ids).to include(active_fenced.id)
        expect(site_ids).not_to include(no_fence.id)
        expect(site_ids).not_to include(Site.find_by(name: "Inactive")&.id)
      end

      described_class.new.perform
    end
  end

  describe "recurring schedule" do
    it "is registered in recurring.yml for both production and development" do
      config = YAML.load_file(Rails.root.join("config/recurring.yml"))

      %w[production development].each do |env|
        entry = config.dig(env, "correlation_evaluate_recent")
        expect(entry).to be_present, "missing recurring entry for #{env}"
        expect(entry["class"]).to eq("Correlations::EvaluateRecentJob")
        expect(entry["schedule"]).to eq("every 10 seconds")
      end
    end
  end
end
