require "rails_helper"

RSpec.describe SignalRuleMatch, type: :model do
  let(:valid_metadata) do
    {
      "distance_km"   => 42.5,
      "signal_type"   => "seismic_event",
      "signal_source" => "usgs_seismic",
      "actions_taken" => ["create_task"]
    }
  end

  def build_match(metadata: valid_metadata)
    build(:signal_rule_match, metadata: metadata)
  end

  describe "metadata schema validation" do
    context "with valid metadata" do
      it "is valid" do
        expect(build_match).to be_valid
      end
    end

    context "when metadata is not a Hash" do
      it "is invalid" do
        expect(build_match(metadata: "not a hash")).not_to be_valid
      end
    end

    context "when distance_km is missing" do
      it "is invalid" do
        m = valid_metadata.except("distance_km")
        expect(build_match(metadata: m)).not_to be_valid
      end
    end

    context "when distance_km is negative" do
      it "is invalid" do
        m = valid_metadata.merge("distance_km" => -1.0)
        expect(build_match(metadata: m)).not_to be_valid
      end
    end

    context "when signal_type is blank" do
      it "is invalid" do
        m = valid_metadata.merge("signal_type" => "")
        expect(build_match(metadata: m)).not_to be_valid
      end
    end

    context "when signal_source is missing" do
      it "is invalid" do
        m = valid_metadata.except("signal_source")
        expect(build_match(metadata: m)).not_to be_valid
      end
    end

    context "when actions_taken contains an unknown action" do
      it "is invalid" do
        m = valid_metadata.merge("actions_taken" => ["create_task", "explode_site"])
        expect(build_match(metadata: m)).not_to be_valid
      end
    end

    context "when actions_taken is empty (no actions fired)" do
      it "is valid — zero actions is a legitimate outcome" do
        m = valid_metadata.merge("actions_taken" => [])
        expect(build_match(metadata: m)).to be_valid
      end
    end

    context "with all valid action types" do
      SignalRuleMatch::VALID_ACTIONS.each do |action|
        it "accepts #{action}" do
          m = valid_metadata.merge("actions_taken" => [action])
          expect(build_match(metadata: m)).to be_valid
        end
      end
    end
  end
end
