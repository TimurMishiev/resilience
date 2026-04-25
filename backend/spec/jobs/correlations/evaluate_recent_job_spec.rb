require "rails_helper"

RSpec.describe Correlations::EvaluateRecentJob, type: :job do
  include ActiveSupport::Testing::TimeHelpers

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

    it "still evaluates signals that landed in the previous 30-second cadence window" do
      travel_to(Time.zone.parse("2026-04-22 12:00:00 UTC")) do
        signal = ExternalSignal.create!(
          source: "usgs_seismic",
          signal_type: "seismic_event",
          external_id: "cadence-window-eq-1",
          lat: 51.6,
          lng: 0.0,
          occurred_at: 20.seconds.ago,
          ingested_at: 20.seconds.ago,
          raw_payload: {}
        )
        site

        expect(Correlations::EvaluatorService).to receive(:call).with(signal: having_attributes(id: signal.id))
        expect(Sites::GeofenceBreachService).to receive(:call).with(
          signal: having_attributes(id: signal.id),
          sites: array_including(having_attributes(id: site.id))
        )

        described_class.new.perform
      end
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

  describe "cursor-based progress (queue-latency drop guard)" do
    # Regression for the old wall-clock design: WINDOW_SECONDS = 32 with a
    # 2-second overlap over the 30-second cadence. A queue backlog of only
    # a few seconds dropped every signal that landed in the latency gap.
    # The cursor tolerates arbitrary backlog — the next successful tick
    # picks up exactly where the last one stopped.

    let(:site) do
      Site.create!(
        name: "Alpha Base",
        latitude: 51.5,
        longitude: -0.1,
        geofence_radius_km: 50,
        status: "active"
      )
    end

    def create_signal(ingested_at:, external_id:)
      ExternalSignal.create!(
        source: "usgs_seismic",
        signal_type: "seismic_event",
        external_id: external_id,
        lat: 51.6,
        lng: 0.0,
        occurred_at: ingested_at,
        ingested_at: ingested_at,
        raw_payload: {}
      )
    end

    it "processes signals ingested during a multi-minute queue backlog" do
      # Sequence:
      #   t=0s      — baseline, cursor initialised
      #   t=+45s    — signal_stale ingested
      #   t=+10min  — job finally runs (simulates long backlog)
      # Old 32-second window would miss signal_stale because
      # window_start = t+10min - 32s is well past t+45s. The cursor
      # stays anchored 1 minute before t=0, so signal_stale is still
      # strictly after the cursor and is processed.
      base = Time.zone.parse("2026-04-22 10:00:00 UTC")

      travel_to(base) { IngestionCursor.for(described_class::CURSOR_NAME) }

      signal_stale = nil
      travel_to(base + 45.seconds) do
        signal_stale = create_signal(ingested_at: Time.current, external_id: "backlog-signal")
      end

      site
      allow(Sites::GeofenceBreachService).to receive(:call)

      travel_to(base + 10.minutes) do
        expect(Correlations::EvaluatorService).to receive(:call).with(signal: having_attributes(id: signal_stale.id))
        described_class.new.perform
      end
    end

    it "advances the cursor to the last processed signal so the next tick does not replay" do
      base = Time.zone.parse("2026-04-22 10:00:00 UTC")
      travel_to(base) { IngestionCursor.for(described_class::CURSOR_NAME) }

      signals = []
      travel_to(base + 30.seconds) do
        signals << create_signal(ingested_at: Time.current, external_id: "advance-a")
        signals << create_signal(ingested_at: Time.current + 0.001, external_id: "advance-b")
      end

      allow(Correlations::EvaluatorService).to receive(:call)
      allow(Sites::GeofenceBreachService).to receive(:call)

      travel_to(base + 1.minute) { described_class.new.perform }

      cursor = IngestionCursor.find_by!(name: described_class::CURSOR_NAME)
      expect(cursor.last_ingested_at).to be_within(0.01).of(signals.last.ingested_at)
      expect(cursor.last_signal_id).to eq(signals.last.id)

      # Second tick with no new signals: nothing replays, cursor unchanged.
      expect(Correlations::EvaluatorService).not_to receive(:call)
      travel_to(base + 2.minutes) { described_class.new.perform }
    end

    it "keeps the cursor anchored when a signal raises so the failure reprocesses on retry" do
      base = Time.zone.parse("2026-04-22 10:00:00 UTC")
      travel_to(base) { IngestionCursor.for(described_class::CURSOR_NAME) }

      signal = nil
      travel_to(base + 30.seconds) { signal = create_signal(ingested_at: Time.current, external_id: "failing") }

      allow(Correlations::EvaluatorService).to receive(:call).and_raise(StandardError, "downstream failed")
      allow(Sites::GeofenceBreachService).to receive(:call)

      cursor_before = IngestionCursor.find_by!(name: described_class::CURSOR_NAME)
      anchor = cursor_before.last_ingested_at

      # retry_on catches; the final attempt propagates. We only care that
      # the cursor is NOT advanced regardless of which attempt we observe.
      travel_to(base + 1.minute) do
        begin
          described_class.new.perform
        rescue StandardError
          # expected — retry_on exhausted in this invocation
        end
      end

      expect(cursor_before.reload.last_ingested_at).to eq(anchor)
      expect(cursor_before.last_signal_id).to be_nil
      expect(signal).to be_persisted
    end
  end

  describe "recurring schedule" do
    it "is registered in recurring.yml for both production and development" do
      config = YAML.load_file(Rails.root.join("config/recurring.yml"))

      %w[production development].each do |env|
        entry = config.dig(env, "correlation_evaluate_recent")
        expect(entry).to be_present, "missing recurring entry for #{env}"
        expect(entry["class"]).to eq("Correlations::EvaluateRecentJob")
        expect(entry["schedule"]).to eq("every 30 seconds")
      end
    end
  end
end
