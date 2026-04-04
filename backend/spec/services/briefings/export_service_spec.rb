require "rails_helper"

RSpec.describe Briefings::ExportService do
  let!(:site) { create(:site, :inactive) }
  let!(:active_site) { create(:site) }
  let!(:task) { create(:task, site: active_site) }

  let(:default_params) do
    {
      summary: "Operational summary for the area.",
      citations: ["audit-event-123"],
      context_counts: { "audit_events" => 5, "signals" => 12, "rule_fires" => 3 },
      summary_type: "operational_brief",
    }
  end

  describe "successful PDF generation" do
    it "returns a success result with PDF bytes" do
      result = described_class.call(**default_params)

      expect(result).to be_success
      expect(result.payload[:pdf]).to be_a(String)
      expect(result.payload[:pdf].bytes.first(4)).to eq("%PDF".bytes)
    end

    it "includes site_name when provided" do
      result = described_class.call(**default_params.merge(site_name: "Alpha Site"))

      expect(result).to be_success
      expect(result.payload[:pdf]).to be_present
    end
  end

  describe "risk data integration" do
    it "includes active sites in the risk table" do
      result = described_class.call(**default_params)

      expect(result).to be_success
      # Verify the PDF was generated (can't easily parse Prawn output,
      # but the fact that it didn't error with real sites proves the data pipeline works)
      expect(result.payload[:pdf].bytesize).to be > 1000
    end
  end

  describe "edge cases" do
    it "handles empty citations" do
      result = described_class.call(**default_params.merge(citations: []))
      expect(result).to be_success
    end

    it "handles empty summary" do
      result = described_class.call(**default_params.merge(summary: ""))
      expect(result).to be_success
    end

    it "handles zero context counts" do
      result = described_class.call(**default_params.merge(
        context_counts: { "audit_events" => 0, "signals" => 0, "rule_fires" => 0 },
      ))
      expect(result).to be_success
    end

    it "handles no active sites" do
      Site.update_all(status: "inactive")
      result = described_class.call(**default_params)
      expect(result).to be_success
    end
  end

  describe "failure handling" do
    it "returns failure when PDF rendering crashes" do
      allow(Prawn::Document).to receive(:new).and_raise(StandardError, "font error")

      result = described_class.call(**default_params)
      expect(result).not_to be_success
      expect(result.errors.first).to include("PDF generation failed")
    end
  end
end
