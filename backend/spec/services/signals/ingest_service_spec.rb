require "rails_helper"

RSpec.describe Signals::IngestService do
  let(:base_attrs) do
    {
      source:      "usgs_seismic",
      signal_type: "seismic_event",
      external_id: "us2024abc",
      lat:          37.5,
      lng:          -118.2,
      occurred_at:  1.hour.ago,
      raw_payload:  { "mag" => 3.5 }
    }
  end

  describe "#call" do
    context "first ingestion" do
      it "returns success" do
        result = described_class.call(**base_attrs)
        expect(result.success).to be true
      end

      it "creates an ExternalSignal record" do
        expect { described_class.call(**base_attrs) }.to change(ExternalSignal, :count).by(1)
      end

      it "marks the result as created" do
        result = described_class.call(**base_attrs)
        expect(result.payload[:created]).to be true
      end

      it "persists all provided attributes" do
        described_class.call(**base_attrs)
        signal = ExternalSignal.last
        expect(signal.source).to      eq("usgs_seismic")
        expect(signal.signal_type).to eq("seismic_event")
        expect(signal.external_id).to eq("us2024abc")
        expect(signal.lat.to_f).to    be_within(0.001).of(37.5)
        expect(signal.lng.to_f).to    be_within(0.001).of(-118.2)
      end
    end

    context "duplicate ingestion (same source + external_id + occurred_at)" do
      before { described_class.call(**base_attrs) }

      it "returns success" do
        result = described_class.call(**base_attrs)
        expect(result.success).to be true
      end

      it "does NOT create a second record — idempotent" do
        expect { described_class.call(**base_attrs) }.not_to change(ExternalSignal, :count)
      end

      it "marks the result as not created" do
        result = described_class.call(**base_attrs)
        expect(result.payload[:created]).to be false
      end
    end

    context "same external_id but different occurred_at" do
      it "creates a second record — treated as a distinct event" do
        described_class.call(**base_attrs)
        expect {
          described_class.call(**base_attrs.merge(occurred_at: 2.hours.ago))
        }.to change(ExternalSignal, :count).by(1)
      end
    end

    context "with optional fields" do
      it "stores altitude, speed, heading, and magnitude" do
        described_class.call(**base_attrs.merge(
          altitude:  10_000,
          speed:     450.0,
          heading:   270,
          magnitude: 3.5
        ))
        signal = ExternalSignal.last
        expect(signal.altitude.to_f).to  eq(10_000)
        expect(signal.speed.to_f).to     eq(450.0)
        expect(signal.heading).to        eq(270)
        expect(signal.magnitude.to_f).to eq(3.5)
      end
    end
  end
end
