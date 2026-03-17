require "rails_helper"

RSpec.describe Correlations::EvaluatorService do
  # Stub SSE broadcasts so tests don't require live streams
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
  end

  # ---------------------------------------------------------------------------
  # Pure math
  # ---------------------------------------------------------------------------
  describe ".haversine_km" do
    it "returns ~0 for identical points" do
      expect(described_class.haversine_km(51.5, 0.0, 51.5, 0.0)).to be_within(0.001).of(0)
    end

    it "calculates London to Paris as ~341 km" do
      # London: 51.5074, -0.1278  |  Paris: 48.8566, 2.3522
      dist = described_class.haversine_km(51.5074, -0.1278, 48.8566, 2.3522)
      expect(dist).to be_within(5).of(341)
    end

    it "returns the same distance regardless of argument order" do
      d1 = described_class.haversine_km(51.5, 0.0, 48.9, 2.4)
      d2 = described_class.haversine_km(48.9, 2.4, 51.5, 0.0)
      expect(d1).to be_within(0.001).of(d2)
    end

    it "returns ~111 km for 1 degree of latitude difference" do
      dist = described_class.haversine_km(0.0, 0.0, 1.0, 0.0)
      expect(dist).to be_within(1).of(111)
    end
  end

  # ---------------------------------------------------------------------------
  # Integration: full evaluation pipeline
  # ---------------------------------------------------------------------------
  describe "#call" do
    let!(:site)  { create(:site, latitude: 51.5, longitude: 0.0) }
    let(:signal) { create(:external_signal, lat: 51.5, lng: 0.1, signal_type: "seismic_event") }

    context "when a rule matches all conditions" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type" => "seismic_event", "proximity_km" => 50 },
               actions:    { "create_task" => { "title" => "Alert", "priority" => "high" } })
      end

      it "returns fired_count of 1 and creates a Task and SignalRuleMatch" do
        expect {
          result = described_class.call(signal: signal)
          expect(result.success).to be true
          expect(result.payload[:fired_count]).to eq(1)
        }.to change(Task, :count).by(1)
         .and change(SignalRuleMatch, :count).by(1)
      end

      it "updates the rule's last_fired_at" do
        expect { described_class.call(signal: signal) }
          .to change { rule.reload.last_fired_at }.from(nil)
      end
    end

    context "when there are no active rules" do
      it "returns fired_count of 0" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when the rule is inactive" do
      let!(:rule) { create(:correlation_rule, :inactive) }

      it "does not fire" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when the rule is on cooldown" do
      let!(:rule) { create(:correlation_rule, :on_cooldown) }

      it "does not fire" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when signal type does not match the rule" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type" => "wildfire", "proximity_km" => 200 })
      end

      it "does not fire" do
        result = described_class.call(signal: signal) # signal is seismic_event
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when the signal is outside the proximity radius" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type" => "seismic_event", "proximity_km" => 1 })
      end
      # signal is at (51.5, 0.1) — ~7 km from site at (51.5, 0.0)

      it "does not fire" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when magnitude is below the threshold" do
      let(:low_mag_signal) do
        create(:external_signal, lat: 51.5, lng: 0.1,
               signal_type: "seismic_event", magnitude: 1.0)
      end
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type" => "seismic_event",
                             "proximity_km" => 200,
                             "magnitude_min" => 5.0 })
      end

      it "does not fire" do
        result = described_class.call(signal: low_mag_signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when magnitude meets the threshold" do
      let(:strong_signal) do
        create(:external_signal, lat: 51.5, lng: 0.1,
               signal_type: "seismic_event", magnitude: 6.0)
      end
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type" => "seismic_event",
                             "proximity_km" => 200,
                             "magnitude_min" => 5.0 })
      end

      it "fires" do
        result = described_class.call(signal: strong_signal)
        expect(result.payload[:fired_count]).to eq(1)
      end
    end

    context "when count_threshold is not yet met" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type"          => "seismic_event",
                             "proximity_km"         => 200,
                             "count_threshold"      => 5,
                             "time_window_minutes"  => 60 })
      end

      it "does not fire when there are fewer signals than the threshold" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end

    context "when count_threshold is met" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type"          => "seismic_event",
                             "proximity_km"         => 200,
                             "count_threshold"      => 2,
                             "time_window_minutes"  => 60 })
      end

      before do
        # Pre-create an existing nearby signal within the time window
        create(:external_signal,
               lat: 51.5, lng: 0.05,
               signal_type: "seismic_event",
               occurred_at: 30.minutes.ago)
      end

      it "fires when enough signals exist in the window" do
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(1)
      end
    end

    context "when the rule is scoped to a specific area_of_operation" do
      let(:other_ao)  { create(:area_of_operation) }
      let(:target_ao) { create(:area_of_operation) }
      let!(:site_in_ao) { create(:site, latitude: 51.5, longitude: 0.0, area_of_operation: target_ao) }

      let!(:rule) do
        create(:correlation_rule,
               area_of_operation: target_ao,
               conditions: { "signal_type" => "seismic_event", "proximity_km" => 50 })
      end

      it "only evaluates sites belonging to the AO" do
        # site without AO should be ignored; only site_in_ao is evaluated
        create(:site, latitude: 51.5, longitude: 0.0, area_of_operation: other_ao)
        result = described_class.call(signal: signal)
        expect(result.payload[:fired_count]).to eq(1)
      end
    end
  end
end
