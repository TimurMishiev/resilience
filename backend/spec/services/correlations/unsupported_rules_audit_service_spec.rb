require "rails_helper"

RSpec.describe Correlations::UnsupportedRulesAuditService do
  let(:io) { StringIO.new }

  it "reports zero malformed rules when all persisted rules are supported" do
    create(:correlation_rule)

    result = described_class.call(io: io)

    expect(result.success).to be(true)
    expect(result.payload[:malformed_count]).to eq(0)
    expect(result.payload[:deactivated_count]).to eq(0)
    expect(io.string).to include("[UnsupportedRuleAudit] malformed_count=0 deactivated_count=0")
  end

  it "reports malformed persisted nested-compound rules without changing active state by default" do
    malformed_rule = build(:correlation_rule,
      name: "Malformed Nested Rule",
      conditions: {
        "operator" => "AND",
        "conditions" => [
          { "signal_type" => "seismic_event", "proximity_km" => 100 },
          { "operator" => "OR", "conditions" => [] }
        ]
      })
    malformed_rule.save!(validate: false)

    result = described_class.call(io: io)

    expect(result.success).to be(true)
    expect(result.payload[:malformed_count]).to eq(1)
    expect(result.payload[:deactivated_count]).to eq(0)
    expect(malformed_rule.reload.is_active).to be(true)
    expect(io.string).to include(%([UnsupportedRuleAudit] rule=#{malformed_rule.id} name="Malformed Nested Rule" active=true deactivated=false))
  end

  it "deactivates malformed active rules when requested" do
    malformed_rule = build(:correlation_rule,
      name: "Deactivate Me",
      conditions: {
        "operator" => "AND",
        "conditions" => [
          { "signal_type" => "seismic_event", "proximity_km" => 100 },
          { "operator" => "OR", "conditions" => [] }
        ]
      })
    malformed_rule.save!(validate: false)

    result = described_class.call(io: io, deactivate: true)

    expect(result.success).to be(true)
    expect(result.payload[:malformed_count]).to eq(1)
    expect(result.payload[:deactivated_count]).to eq(1)
    expect(result.payload[:deactivated_rule_ids]).to contain_exactly(malformed_rule.id)
    expect(malformed_rule.reload.is_active).to be(false)
    expect(io.string).to include(%([UnsupportedRuleAudit] rule=#{malformed_rule.id} name="Deactivate Me" active=false deactivated=true))
    expect(io.string).to include("[UnsupportedRuleAudit] malformed_count=1 deactivated_count=1")
  end
end
