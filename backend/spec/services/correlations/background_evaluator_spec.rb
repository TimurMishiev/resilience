require "rails_helper"

RSpec.describe Correlations::BackgroundEvaluator do
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Rails.logger).to receive(:info)
    allow(Rails.logger).to receive(:warn)
    allow(Rails.logger).to receive(:error)
    allow(Observability).to receive(:capture_exception)
  end

  describe ".start" do
    it "returns a Thread" do
      thread = described_class.start
      expect(thread).to be_a(Thread)
    ensure
      thread&.kill
      thread&.join(1)
    end

    context "when signals are ingested within the poll window" do
      # Builds a minimal signal double that mimics a SELECT-limited AR object.
      # The real BackgroundEvaluator selects only 8 fields — we test that here
      # by stubbing find_each to yield objects with only those attributes.
      let(:fake_signal) do
        instance_double(
          ExternalSignal,
          id:          "sig-1",
          source:      "opensky",
          signal_type: "aircraft_position",
          external_id: "AA123",
          lat:         51.5,
          lng:         0.0,
          occurred_at: 5.seconds.ago,
          ingested_at: 5.seconds.ago,
        )
      end

      let(:fake_site) do
        instance_double(
          Site,
          id:                "site-1",
          name:              "Port Alpha",
          latitude:          51.5,
          longitude:         0.0,
          geofence_radius_km: 3.0,
        )
      end

      # Build a relation chain that yields fake_signal via find_each
      let(:signal_scope) { instance_double(ActiveRecord::Relation) }
      let(:site_scope)   { instance_double(ActiveRecord::Relation) }

      before do
        # Stub the ExternalSignal select → where chain
        select_scope = instance_double(ActiveRecord::Relation)
        allow(ExternalSignal).to receive(:select).and_return(select_scope)
        allow(select_scope).to receive(:where).and_return(signal_scope)
        allow(signal_scope).to receive(:find_each).and_yield(fake_signal)

        # Stub the Site active → where → select chain
        active_scope  = instance_double(ActiveRecord::Relation)
        where_scope   = instance_double(ActiveRecord::Relation)
        allow(Site).to receive(:active).and_return(active_scope)
        allow(active_scope).to receive(:where).and_return(where_scope)
        allow(where_scope).to receive(:select).and_return(site_scope)
        allow(site_scope).to receive(:to_a).and_return([fake_site])

        allow(Correlations::EvaluatorService).to receive(:call)
        allow(Sites::GeofenceBreachService).to receive(:call).and_return(ServiceResult.success)
      end

      it "calls EvaluatorService with the signal" do
        done = Queue.new
        allow(Correlations::EvaluatorService).to receive(:call) do |args|
          done << :tick
          nil
        end

        thread = described_class.start
        done.pop(timeout: 5)
        thread.kill
        thread.join(1)

        expect(Correlations::EvaluatorService).to have_received(:call)
          .with(hash_including(signal: fake_signal))
      end

      it "calls GeofenceBreachService with the pre-loaded sites array" do
        done = Queue.new
        allow(Sites::GeofenceBreachService).to receive(:call).and_wrap_original do |_orig, args|
          done << args[:sites]
          ServiceResult.success
        end

        thread = described_class.start
        sites_passed = done.pop(timeout: 5)
        thread.kill
        thread.join(1)

        expect(sites_passed).to eq([fake_site])
      end

      it "passes an Array (not a relation) to GeofenceBreachService so it is not re-queried per signal" do
        done = Queue.new
        allow(Sites::GeofenceBreachService).to receive(:call).and_wrap_original do |_orig, args|
          done << args[:sites]
          ServiceResult.success
        end

        thread = described_class.start
        sites_passed = done.pop(timeout: 5)
        thread.kill
        thread.join(1)

        expect(sites_passed).to be_an(Array)
      end
    end
  end
end
