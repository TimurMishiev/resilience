require 'rails_helper'

RSpec.describe Sites::GeofenceBreachService, type: :service do
  let(:logger) { instance_double(ActiveSupport::Logger, error: nil, warn: nil, debug: nil) }

  before do
    allow(Rails).to receive(:logger).and_return(logger)
    allow(Sse::Broadcaster.instance).to receive(:publish)
    allow(Incidents::FusionService).to receive(:call)
  end

  # Site centred on London (51.5°N, 0.0°E) with a 100 km geofence.
  let!(:site) { create(:site, latitude: 51.5, longitude: 0.0, geofence_radius_km: 100.0) }

  # Signal ~50 km south of the site — within the 100 km geofence.
  let(:signal_inside) do
    create(:external_signal, lat: 51.05, lng: 0.0)
  end

  # Signal ~200 km north — outside the 100 km geofence.
  let(:signal_outside) do
    create(:external_signal, lat: 53.3, lng: 0.0)
  end

  describe "#call" do
    context "when a signal is inside the site's geofence" do
      it "creates a SignalRuleMatch breach record" do
        expect {
          described_class.call(signal: signal_inside)
        }.to change(SignalRuleMatch, :count).by(1)
      end

      it "returns success with the breach listed" do
        result = described_class.call(signal: signal_inside)
        expect(result.success).to be true
        expect(result.payload[:count]).to eq 1
      end

      it "sets correlation_rule_id to nil" do
        described_class.call(signal: signal_inside)
        match = SignalRuleMatch.last
        expect(match.correlation_rule_id).to be_nil
      end

      it "sets geofence_breach: true in metadata" do
        described_class.call(signal: signal_inside)
        match = SignalRuleMatch.last
        expect(match.metadata["geofence_breach"]).to be true
      end

      it "records the distance_km in metadata" do
        described_class.call(signal: signal_inside)
        match = SignalRuleMatch.last
        expect(match.metadata["distance_km"]).to be_a(Numeric)
        expect(match.metadata["distance_km"]).to be < 100.0
      end

      it "assigns confidence between 0 and 1" do
        described_class.call(signal: signal_inside)
        match = SignalRuleMatch.last
        expect(match.confidence).to be_between(0.0, 1.0)
      end

      it "is idempotent — does not create a second record on repeat call" do
        described_class.call(signal: signal_inside)
        expect {
          described_class.call(signal: signal_inside)
        }.not_to change(SignalRuleMatch, :count)
      end

      it "still publishes the breach when incident fusion raises unexpectedly" do
        allow(Incidents::FusionService).to receive(:call).and_raise(StandardError, "fusion exploded")

        result = described_class.call(signal: signal_inside)

        expect(result.success).to be true
        expect(result.payload[:count]).to eq 1
        expect(Sse::Broadcaster.instance).to have_received(:publish).with(
          hash_including(event: "geofence_breach", data: hash_including(site_id: site.id, signal_id: signal_inside.id))
        )
        expect(logger).to have_received(:error).with(include("incident fusion failed", "fusion exploded"))
      end
    end

    context "when a signal is outside the site's geofence" do
      it "does not create a breach record" do
        expect {
          described_class.call(signal: signal_outside)
        }.not_to change(SignalRuleMatch, :count)
      end

      it "returns success with zero breaches" do
        result = described_class.call(signal: signal_outside)
        expect(result.success).to be true
        expect(result.payload[:count]).to eq 0
      end
    end

    context "when the site has no geofence radius" do
      let!(:site) { create(:site, latitude: 51.5, longitude: 0.0, geofence_radius_km: 0.1) }

      it "does not create a breach record for a signal far away" do
        expect {
          described_class.call(signal: signal_outside)
        }.not_to change(SignalRuleMatch, :count)
      end
    end

    context "with multiple active sites" do
      let!(:site2) { create(:site, latitude: 51.4, longitude: 0.1, geofence_radius_km: 100.0) }

      it "creates breach records for all matching sites" do
        expect {
          described_class.call(signal: signal_inside)
        }.to change(SignalRuleMatch, :count).by(2)
      end
    end

    context "when the site is inactive" do
      let!(:site) { create(:site, :inactive, latitude: 51.5, longitude: 0.0, geofence_radius_km: 100.0) }

      it "skips inactive sites" do
        expect {
          described_class.call(signal: signal_inside)
        }.not_to change(SignalRuleMatch, :count)
      end
    end

    context "SSE broadcast resilience" do
      it "still creates the breach record and returns success when the broadcaster raises" do
        allow(Sse::Broadcaster.instance).to receive(:publish).and_raise(StandardError, "Redis connection lost")

        result = described_class.call(signal: signal_inside)

        expect(result.success).to be true
        expect(SignalRuleMatch.count).to eq(1)
      end
    end
  end
end
