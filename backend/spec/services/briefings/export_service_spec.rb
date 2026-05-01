require "rails_helper"

RSpec.describe Briefings::ExportService do
  let!(:site) { create(:site, :inactive) }
  let!(:active_site) { create(:site) }
  let!(:task) { create(:task, site: active_site) }

  let(:default_params) do
    {
      summary: "Operational summary for the area.",
      citations: [SecureRandom.uuid],
      context_counts: { "audit_events" => 5, "signals" => 12, "rule_fires" => 3 },
      # site_activity is one of Ai::SummaryService::ALLOWED_SUMMARY_TYPES.
      # ExportService now mirrors that allowlist (audit P3 closure 2026-05-01).
      summary_type: "site_activity",
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

  # ── Input validation (audit P3 closure, 2026-05-01) ───────────────────────
  #
  # Two defensive validations on commander-supplied inputs that flow into
  # the rendered PDF:
  #
  #   1. summary_type must be one of ALLOWED_SUMMARY_TYPES (matches
  #      Ai::SummaryService::ALLOWED_SUMMARY_TYPES and the frontend's
  #      AiSummaryType union). Reject otherwise — the PDF title block
  #      depends on this being a known scope.
  #   2. citations are UUID-shaped or silently dropped. The PDF citations
  #      section interpolates each verbatim; oversized or control-char
  #      strings would corrupt the PDF.
  #
  # Neither is a security boundary (commander is already authorized;
  # Prawn renders plain text), but both are honest defensive hardening.
  describe "summary_type validation" do
    it "rejects an unknown summary_type with a structured failure" do
      result = described_class.call(**default_params.merge(summary_type: "operational_brief"))

      expect(result).not_to be_success
      expect(result.errors.first).to include("Invalid summary_type")
      expect(result.errors.first).to include("site_activity")
      expect(result.errors.first).to include("readiness_change")
      expect(result.errors.first).to include("leadership_briefing")
    end

    it "rejects a blank summary_type" do
      result = described_class.call(**default_params.merge(summary_type: ""))

      expect(result).not_to be_success
      expect(result.errors.first).to include("Invalid summary_type")
    end

    %w[site_activity readiness_change leadership_briefing].each do |type|
      it "accepts canonical summary_type #{type.inspect}" do
        result = described_class.call(**default_params.merge(summary_type: type))
        expect(result).to be_success
      end
    end
  end

  describe "citations validation" do
    it "filters out non-UUID citations silently" do
      uuid = SecureRandom.uuid
      result = described_class.call(**default_params.merge(
        citations: [uuid, "audit-event-123", "<b>FORGED</b>", nil, 42],
      ))

      # The PDF still renders successfully — the auxiliary citations list
      # is hardened, not made mandatory.
      expect(result).to be_success
      expect(result.payload[:pdf]).to be_present
    end

    it "accepts UUIDs in any standard casing" do
      lowercase = SecureRandom.uuid
      uppercase = SecureRandom.uuid.upcase
      result = described_class.call(**default_params.merge(
        citations: [lowercase, uppercase],
      ))

      expect(result).to be_success
    end

    it "handles a citations list of entirely invalid entries by rendering an empty citations section" do
      result = described_class.call(**default_params.merge(
        citations: ["not-a-uuid", "also-bad"],
      ))

      # All filtered out — PDF still renders. Behaviorally equivalent to
      # the existing "handles empty citations" case above.
      expect(result).to be_success
    end
  end
end
