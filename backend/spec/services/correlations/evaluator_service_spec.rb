require "rails_helper"

RSpec.describe Correlations::EvaluatorService do
  include ActiveJob::TestHelper

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

      # Use inline adapter so RuleFiringJob executes synchronously in these tests,
      # allowing us to assert on the Task/SignalRuleMatch side-effects.
      around { |ex| perform_enqueued_jobs { ex.run } }

      it "returns fired_count of 1 and enqueues a RuleFiringJob that creates a Task and SignalRuleMatch" do
        expect {
          result = described_class.call(signal: signal)
          expect(result.success).to be true
          expect(result.payload[:fired_count]).to eq(1)
        }.to change(Task, :count).by(1)
         .and change(SignalRuleMatch, :count).by(1)
      end

      it "updates the rule's last_fired_at via the enqueued job" do
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

    context "when count_threshold is met without a proximity constraint" do
      let!(:rule) do
        create(:correlation_rule,
               conditions: { "signal_type"          => "seismic_event",
                             "proximity_km"         => 0,
                             "count_threshold"      => 2,
                             "time_window_minutes"  => 60 })
      end

      before do
        create(:external_signal,
               lat: 10.0, lng: 10.0,
               signal_type: "seismic_event",
               occurred_at: 30.minutes.ago)
      end

      it "fires using the full time window instead of exact site overlap" do
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

    # -------------------------------------------------------------------------
    # Compound AND / OR rules
    # -------------------------------------------------------------------------
    #
    # Compound rules require two or more sub-conditions evaluated via
    # normalized_conditions. Each sub-condition either:
    #   - matches the incoming signal's type (direct path), or
    #   - requires a corroborating DB signal of a different type (corroboration path).
    #
    # The operator (AND / OR) determines whether all or any must be satisfied.
    # -------------------------------------------------------------------------

    context "compound AND rule" do
      # Signal that triggers evaluation
      let(:ais_gap_signal) do
        create(:external_signal,
               signal_type: "ais_gap",
               source:      "derived",
               lat:         51.5,
               lng:         0.1,
               occurred_at: Time.current)
      end

      # Rule: AIS gap AND GPS jamming must both be present near the site
      let!(:compound_and_rule) do
        create(:correlation_rule,
               conditions: {
                 "operator"   => "AND",
                 "conditions" => [
                   { "signal_type" => "ais_gap",     "proximity_km" => 50 },
                   { "signal_type" => "gps_jamming", "proximity_km" => 50 }
                 ]
               })
      end

      it "does not fire when the corroborating gps_jamming signal is absent" do
        result = described_class.call(signal: ais_gap_signal)
        expect(result.payload[:fired_count]).to eq(0)
      end

      context "when a corroborating gps_jamming signal exists near the site" do
        before do
          # Place a GPS jamming signal within 50 km of the site at (51.5, 0.0)
          create(:external_signal,
                 signal_type: "gps_jamming",
                 source:      "gpsjam",
                 lat:         51.5,
                 lng:         0.05,   # ~4 km from site
                 occurred_at: 30.minutes.ago)
        end

        it "fires when both conditions are satisfied" do
          result = described_class.call(signal: ais_gap_signal)
          expect(result.payload[:fired_count]).to eq(1)
        end
      end

      context "when the corroborating condition has no proximity constraint" do
        let!(:compound_and_rule) do
          create(:correlation_rule,
                 conditions: {
                   "operator"   => "AND",
                   "conditions" => [
                     { "signal_type" => "ais_gap",     "proximity_km" => 50 },
                     { "signal_type" => "gps_jamming", "proximity_km" => 0 }
                   ]
                 })
        end

        before do
          create(:external_signal,
                 signal_type: "gps_jamming",
                 source:      "gpsjam",
                 lat:         10.0,
                 lng:         10.0,
                 occurred_at: 30.minutes.ago)
        end

        it "fires when a corroborating signal exists anywhere in the time window" do
          result = described_class.call(signal: ais_gap_signal)
          expect(result.payload[:fired_count]).to eq(1)
        end
      end

      context "when the corroborating gps_jamming signal is outside the proximity radius" do
        before do
          # GPS jamming signal far from the site — beyond 50 km
          create(:external_signal,
                 signal_type: "gps_jamming",
                 source:      "gpsjam",
                 lat:         52.5,   # ~111 km north of site
                 lng:         0.0,
                 occurred_at: 30.minutes.ago)
        end

        it "does not fire when corroborating signal is out of range" do
          result = described_class.call(signal: ais_gap_signal)
          expect(result.payload[:fired_count]).to eq(0)
        end
      end
    end

    context "compound OR rule" do
      # Rule: AIS gap OR GPS jamming — either signal alone is sufficient
      let!(:compound_or_rule) do
        create(:correlation_rule,
               conditions: {
                 "operator"   => "OR",
                 "conditions" => [
                   { "signal_type" => "ais_gap",     "proximity_km" => 50 },
                   { "signal_type" => "gps_jamming", "proximity_km" => 50 }
                 ]
               })
      end

      it "fires when only the first condition is met (ais_gap incoming signal)" do
        ais_gap_signal = create(:external_signal,
                                signal_type: "ais_gap",
                                source:      "derived",
                                lat:         51.5,
                                lng:         0.1)
        result = described_class.call(signal: ais_gap_signal)
        expect(result.payload[:fired_count]).to eq(1)
      end

      it "fires when only the second condition is met (gps_jamming incoming signal)" do
        gps_signal = create(:external_signal,
                            signal_type: "gps_jamming",
                            source:      "gpsjam",
                            lat:         51.5,
                            lng:         0.1)
        result = described_class.call(signal: gps_signal)
        expect(result.payload[:fired_count]).to eq(1)
      end

      it "does not fire when neither condition is met" do
        # seismic_event matches neither ais_gap nor gps_jamming, and no
        # corroborating signals of either type exist in the DB
        seismic_signal = create(:external_signal,
                                signal_type: "seismic_event",
                                lat:         51.5,
                                lng:         0.1)
        result = described_class.call(signal: seismic_signal)
        expect(result.payload[:fired_count]).to eq(0)
      end
    end
  end

  describe "candidate query shaping" do
    let!(:site) { create(:site, latitude: 51.5, longitude: 0.0) }
    let(:signal) { create(:external_signal, lat: 51.5, lng: 0.1, signal_type: "seismic_event") }
    let(:service) { described_class.new(signal: signal) }

    it "applies the bounding-box prefilter when proximity is positive" do
      base_scope = double("base_scope")
      narrowed_scope = double("narrowed_scope")

      expect(ExternalSignal).to receive(:where).with(
        signal_type: "gps_jamming",
        occurred_at: kind_of(Range),
      ).and_return(base_scope)
      expect(base_scope).to receive(:near_point).with(site.latitude, site.longitude, 50.0).and_return(narrowed_scope)

      result = service.send(
        :recent_signal_candidates,
        signal_type: "gps_jamming",
        window_minutes: 60,
        site: site,
        proximity_km: 50.0,
      )

      expect(result).to eq(narrowed_scope)
    end

    it "skips the bounding-box prefilter when proximity is zero" do
      base_scope = double("base_scope")

      expect(ExternalSignal).to receive(:where).with(
        signal_type: "gps_jamming",
        occurred_at: kind_of(Range),
      ).and_return(base_scope)
      expect(base_scope).not_to receive(:near_point)

      result = service.send(
        :recent_signal_candidates,
        signal_type: "gps_jamming",
        window_minutes: 60,
        site: site,
        proximity_km: 0,
      )

      expect(result).to eq(base_scope)
    end

    it "caps zero-proximity threshold checks to the requested number of ids" do
      scope = double("scope")
      limited_scope = double("limited_scope")

      expect(scope).to receive(:limit).with(3).and_return(limited_scope)
      expect(limited_scope).to receive(:pluck).with(:id).and_return(%w[a b c])

      expect(service.send(:threshold_met?, scope, site, 0, 3)).to be(true)
    end

    it "counts proximity-constrained matches in batches and exits once the threshold is met" do
      scope = double("scope")
      selected_scope = double("selected_scope")
      matching_signal = build(:external_signal, lat: 51.5, lng: 0.01)
      far_signal = build(:external_signal, lat: 53.0, lng: 0.0)

      expect(scope).to receive(:select).with(:id, :lat, :lng).and_return(selected_scope)
      expect(selected_scope).to receive(:find_in_batches)
        .with(batch_size: described_class::SIGNAL_CANDIDATE_BATCH_SIZE)
        .and_yield([matching_signal, far_signal])

      expect(service.send(:threshold_met?, scope, site, 5.0, 1)).to be(true)
    end
  end
end
