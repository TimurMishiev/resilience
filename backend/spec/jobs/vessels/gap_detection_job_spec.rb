require "rails_helper"

RSpec.describe Vessels::GapDetectionJob, type: :job do
  let(:job) { described_class.new }

  describe "#perform" do
    context "when no vessels are dark" do
      it "synthesizes no signals" do
        create(:vessel, last_seen_at: 5.minutes.ago)
        expect { job.perform }.not_to change(ExternalSignal, :count)
      end
    end

    context "when a vessel has been dark for > 20 minutes" do
      let!(:dark_vessel) do
        create(:vessel,
          mmsi:         "111222333",
          last_seen_at: 30.minutes.ago,
          speed:        3.0   # between low and high threshold
        )
      end

      it "synthesizes an ais_gap signal" do
        expect { job.perform }.to change(ExternalSignal, :count).by(1)

        signal = ExternalSignal.last
        expect(signal.signal_type).to eq("ais_gap")
        expect(signal.source).to eq("derived")
      end

      it "uses the vessel's last position" do
        job.perform
        signal = ExternalSignal.last
        expect(signal.lat).to eq(dark_vessel.lat)
        expect(signal.lng).to eq(dark_vessel.lng)
      end

      it "sets a stable external_id tied to last_seen_at" do
        job.perform
        expected_id = "gap_#{dark_vessel.mmsi}_#{dark_vessel.last_seen_at.to_i}"
        expect(ExternalSignal.last.external_id).to eq(expected_id)
      end

      it "stores gap metadata in raw_payload" do
        job.perform
        payload = ExternalSignal.last.raw_payload
        expect(payload["mmsi"]).to eq("111222333")
        expect(payload["gap_minutes"]).to be > 0
        expect(payload["confidence"]).to be_a(Float)
      end
    end

    context "confidence scoring" do
      it "scores higher when vessel was underway at speed (>= 5 knots = 2.57 m/s)" do
        vessel = create(:vessel, last_seen_at: 30.minutes.ago, speed: 5.0)
        job.perform
        signal = ExternalSignal.find_by(external_id: "gap_#{vessel.mmsi}_#{vessel.last_seen_at.to_i}")
        expect(signal.magnitude).to be >= 0.70  # base 0.50 + 0.25 - small tolerance
      end

      it "scores lower when vessel was nearly stationary (< 1 knot = 0.51 m/s)" do
        vessel = create(:vessel, last_seen_at: 30.minutes.ago, speed: 0.2)
        job.perform
        signal = ExternalSignal.find_by(external_id: "gap_#{vessel.mmsi}_#{vessel.last_seen_at.to_i}")
        expect(signal.magnitude).to be <= 0.35  # base 0.50 - 0.20 + tolerance
      end

      it "scores base 0.50 when speed is unknown" do
        vessel = create(:vessel, last_seen_at: 30.minutes.ago, speed: nil)
        job.perform
        signal = ExternalSignal.find_by(external_id: "gap_#{vessel.mmsi}_#{vessel.last_seen_at.to_i}")
        expect(signal.magnitude).to eq(0.50)
      end
    end

    context "idempotency" do
      it "does not create a duplicate signal when run twice for the same gap" do
        create(:vessel, mmsi: "444555666", last_seen_at: 30.minutes.ago, speed: nil)

        expect { job.perform }.to change(ExternalSignal, :count).by(1)
        expect { job.perform }.not_to change(ExternalSignal, :count)
      end
    end
  end
end
