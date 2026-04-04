require "rails_helper"

RSpec.describe Signals::PayloadSerializer do
  describe ".call" do
    it "serializes an ExternalSignal to a hash with expected keys" do
      signal = create(:external_signal)
      result = described_class.call(signal)

      expect(result).to include(
        "id"          => signal.id,
        "source"      => signal.source,
        "signal_type" => signal.signal_type,
      )
      expect(result).to have_key("lat")
      expect(result).to have_key("lng")
      expect(result).to have_key("occurred_at")
    end

    it "includes raw_payload" do
      signal = create(:external_signal, raw_payload: { "key" => "value" })
      result = described_class.call(signal)

      expect(result[:raw_payload]).to eq("key" => "value")
    end

    it "excludes fields not in the allow-list" do
      signal = create(:external_signal)
      result = described_class.call(signal)

      expect(result).not_to have_key("created_at")
      expect(result).not_to have_key("updated_at")
      expect(result).not_to have_key("dedup_key")
    end
  end
end
