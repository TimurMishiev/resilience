require "rails_helper"

RSpec.describe CorrelationRule, type: :model do
  # ── normalized_conditions ────────────────────────────────────────────────────

  describe "#normalized_conditions" do
    context "with a legacy flat rule" do
      let(:rule) { build(:correlation_rule, conditions: { "signal_type" => "gps_jamming", "proximity_km" => 50 }) }

      it "wraps the flat hash in a single-element AND" do
        norm = rule.normalized_conditions
        expect(norm["operator"]).to eq("AND")
        expect(norm["conditions"]).to eq([ { "signal_type" => "gps_jamming", "proximity_km" => 50 } ])
      end

      it "is idempotent — calling twice returns the same structure" do
        expect(rule.normalized_conditions).to eq(rule.normalized_conditions)
      end
    end

    context "with a compound rule" do
      let(:rule) { build(:correlation_rule, :compound) }

      it "returns conditions unchanged" do
        expect(rule.normalized_conditions).to eq(rule.conditions)
      end

      it "preserves the operator" do
        expect(rule.normalized_conditions["operator"]).to eq("AND")
      end

      it "preserves all sub-conditions" do
        expect(rule.normalized_conditions["conditions"].length).to eq(2)
      end
    end
  end

  # ── compound? ────────────────────────────────────────────────────────────────

  describe "#compound?" do
    it "returns false for legacy flat rules" do
      rule = build(:correlation_rule)
      expect(rule.compound?).to be false
    end

    it "returns true for compound rules" do
      rule = build(:correlation_rule, :compound)
      expect(rule.compound?).to be true
    end
  end

  # ── Validation: legacy rules ─────────────────────────────────────────────────

  describe "legacy rule validation" do
    it "accepts a valid legacy rule" do
      expect(build(:correlation_rule)).to be_valid
    end

    it "rejects an unknown signal_type in legacy rule" do
      rule = build(:correlation_rule, conditions: { "signal_type" => "laser_beam" })
      expect(rule).not_to be_valid
      expect(rule.errors[:conditions].first).to include("signal_type 'laser_beam' is not recognised")
    end

    it "accepts ais_gap as a valid signal_type" do
      rule = build(:correlation_rule, conditions: { "signal_type" => "ais_gap", "proximity_km" => 100 })
      expect(rule).to be_valid
    end

    it "rejects a negative proximity_km" do
      rule = build(:correlation_rule, conditions: { "signal_type" => "gps_jamming", "proximity_km" => -1 })
      expect(rule).not_to be_valid
    end
  end

  # ── Validation: compound rules ───────────────────────────────────────────────

  describe "compound rule validation" do
    it "accepts a valid compound AND rule" do
      expect(build(:correlation_rule, :compound)).to be_valid
    end

    it "accepts a valid compound OR rule" do
      rule = build(:correlation_rule, conditions: {
        "operator" => "OR",
        "conditions" => [
          { "signal_type" => "ais_gap",     "proximity_km" => 100 },
          { "signal_type" => "gps_jamming", "proximity_km" => 50  }
        ]
      })
      expect(rule).to be_valid
    end

    it "rejects an invalid operator" do
      rule = build(:correlation_rule, conditions: {
        "operator" => "XOR",
        "conditions" => [
          { "signal_type" => "ais_gap" },
          { "signal_type" => "gps_jamming" }
        ]
      })
      expect(rule).not_to be_valid
      expect(rule.errors[:conditions].first).to include("operator must be one of: AND, OR")
    end

    it "rejects a compound rule with fewer than 2 conditions" do
      rule = build(:correlation_rule, conditions: {
        "operator" => "AND",
        "conditions" => [ { "signal_type" => "ais_gap" } ]
      })
      expect(rule).not_to be_valid
      expect(rule.errors[:conditions].first).to include("at least 2 condition objects")
    end

    it "rejects invalid signal_type within a compound condition" do
      rule = build(:correlation_rule, conditions: {
        "operator" => "AND",
        "conditions" => [
          { "signal_type" => "ais_gap" },
          { "signal_type" => "laser_beam" }
        ]
      })
      expect(rule).not_to be_valid
      expect(rule.errors[:conditions].first).to include("conditions[1].signal_type 'laser_beam'")
    end

    it "rejects invalid proximity_km within a compound condition" do
      rule = build(:correlation_rule, conditions: {
        "operator" => "AND",
        "conditions" => [
          { "signal_type" => "ais_gap",     "proximity_km" => 100 },
          { "signal_type" => "gps_jamming", "proximity_km" => -5  }
        ]
      })
      expect(rule).not_to be_valid
      expect(rule.errors[:conditions].first).to include("conditions[1].proximity_km")
    end
  end
end
