require "prawn"
require "prawn/table"
Prawn::Fonts::AFM.hide_m17n_warning = true

module Briefings
  # Generates a classified PDF operational briefing.
  #
  # Accepts the AI-generated summary payload (already produced by Ai::SummaryService
  # on the frontend request), augments it with live risk scores for all active sites,
  # and renders a Prawn PDF with:
  #
  #   - Classification banner (header + footer on every page)
  #   - Title block: briefing type, scope, generated timestamp, grounding counts
  #   - Risk Assessment table: all active sites sorted by score descending
  #   - Intelligence Summary: the AI-generated prose
  #   - Audit Citations: referenced audit event IDs (if any)
  #
  # The PDF is returned as a raw binary String via ServiceResult#payload[:pdf].
  class ExportService < ApplicationService
    BANNER_TEXT = "UNCLASSIFIED // FOR OFFICIAL USE ONLY"
    BANNER_BG   = "1a2332"
    BANNER_H    = 22  # points

    RISK_PALETTE = {
      "low"      => "27ae60",
      "moderate" => "d4a017",
      "high"     => "e67e22",
      "critical" => "c0392b"
    }.freeze

    def initialize(summary:, citations:, context_counts:, summary_type:, site_name: nil)
      @summary        = summary.to_s
      @citations      = Array(citations)
      @context_counts = context_counts.transform_keys(&:to_sym)
      @summary_type   = summary_type.to_s
      @site_name      = site_name
    end

    def call
      risk_data = fetch_risk_data
      pdf_bytes = render_pdf(risk_data)
      ServiceResult.success(pdf: pdf_bytes)
    rescue => e
      ServiceResult.failure(errors: ["PDF generation failed: #{e.message}"])
    end

    private

    # ── data ─────────────────────────────────────────────────────────────────

    def fetch_risk_data
      sites = Site.active.includes(:tasks).order(:name)
      sites.map do |site|
        readiness = Readiness::CalculationService.call(site: site, tasks: site.tasks)
        risk      = Risk::ScoringService.call(
          site:            site,
          readiness_score: readiness.payload[:score]
        )
        p = risk.payload
        {
          name:           site.name,
          score:          p[:score],
          risk_level:     p[:risk_level],
          alert_pressure: p[:components][:alert_pressure],
          task_health:    p[:components][:task_health],
          signal_density: p[:components][:signal_density]
        }
      end
    end

    # ── PDF rendering ─────────────────────────────────────────────────────────

    def render_pdf(risk_data)
      # Top and bottom margins reserve space for the classification banner strips.
      pdf = Prawn::Document.new(
        page_size: "LETTER",
        margin:    [BANNER_H + 38, 50, BANNER_H + 38, 50]
      )

      add_repeating_elements(pdf)
      add_title_block(pdf)
      add_risk_section(pdf, risk_data)
      add_summary_section(pdf)
      add_citations_section(pdf)

      pdf.render
    end

    # Draws classification banners on every page and a page-number stamp.
    def add_repeating_elements(pdf)
      pdf.repeat(:all) do
        pdf.canvas do
          pw = pdf.bounds.right  # page width  (612 pts for LETTER)
          ph = pdf.bounds.top    # page height (792 pts for LETTER)

          # Top banner
          pdf.fill_color BANNER_BG
          pdf.fill_rectangle [0, ph], pw, BANNER_H

          # Bottom banner
          pdf.fill_rectangle [0, BANNER_H], pw, BANNER_H

          # Banner text (white, centered)
          pdf.fill_color "ffffff"
          [ph, BANNER_H].each do |y|
            pdf.text_box BANNER_TEXT,
              at:     [0, y],
              width:  pw,
              height: BANNER_H,
              align:  :center,
              valign: :center,
              size:   7,
              style:  :bold
          end

          pdf.fill_color "000000"
        end
      end

      # Page numbers sit just below the content area (inside the bottom margin gap)
      pdf.number_pages "<page> of <total>",
        at:    [pdf.bounds.right - 80, -(BANNER_H + 12)],
        align: :right,
        size:  8,
        color: "8a9ba8"
    end

    # Title, scope line, and grounding metadata.
    def add_title_block(pdf)
      pdf.font_size(20) do
        pdf.text "OPERATIONAL BRIEFING", style: :bold, align: :center, color: "1a2332"
      end
      pdf.move_down 4

      scope        = @site_name ? "Site: #{@site_name}" : "All Sites"
      type_label   = @summary_type.tr("_", " ").split.map(&:capitalize).join(" ")
      generated_at = Time.zone.now.strftime("%Y-%m-%d %H:%M UTC")

      pdf.text "#{type_label}  ·  #{scope}  ·  Generated #{generated_at}",
               size: 9, align: :center, color: "8a9ba8"

      total_rec = (@context_counts[:audit_events] || 0) +
                  (@context_counts[:signals]       || 0) +
                  (@context_counts[:rule_fires]    || 0)
      pdf.move_down 3
      pdf.text "Grounded in #{total_rec} records " \
               "(#{@context_counts[:audit_events]} audit events · " \
               "#{@context_counts[:signals]} signals · " \
               "#{@context_counts[:rule_fires]} rule fires)",
               size: 8, align: :center, color: "8a9ba8"

      pdf.move_down 14
      divider(pdf)
    end

    # Risk table for all active sites, sorted highest risk first.
    def add_risk_section(pdf, risk_data)
      return if risk_data.empty?

      section_header(pdf, "RISK ASSESSMENT")

      sorted = risk_data.sort_by { |r| -r[:score] }

      headers = [["Site", "Score", "Risk Level", "Alert\nPressure", "Task\nHealth", "Signal\nDensity"]]
      rows    = sorted.map do |r|
        [
          r[:name],
          r[:score].to_s,
          r[:risk_level].upcase,
          r[:alert_pressure].round(1).to_s,
          r[:task_health].round(1).to_s,
          r[:signal_density].round(1).to_s
        ]
      end

      pdf.table(headers + rows,
        width:      pdf.bounds.width,
        header:     true,
        row_colors: %w[ffffff f5f8fa],
        cell_style: { size: 9, padding: [5, 7], border_color: "e1e8ed", border_width: 0.5 }
      ) do |t|
        # Header row
        t.row(0).background_color = BANNER_BG
        t.row(0).text_color       = "ffffff"
        t.row(0).font_style       = :bold
        t.row(0).align            = :center
        t.row(0).border_color     = BANNER_BG

        # Color-code risk level column
        sorted.each_with_index do |r, i|
          color = RISK_PALETTE[r[:risk_level]] || "000000"
          t.row(i + 1).columns(2).text_color = color
          t.row(i + 1).columns(2).font_style = :bold
        end

        # Numeric columns centred
        [1, 3, 4, 5].each { |c| t.column(c).align = :center }
      end

      pdf.move_down 14
      divider(pdf)
    end

    # AI-generated operational summary prose.
    def add_summary_section(pdf)
      section_header(pdf, "INTELLIGENCE SUMMARY")
      pdf.text @summary, size: 10, leading: 4
    end

    # Audit citation UUIDs (only present when the AI referenced specific events).
    def add_citations_section(pdf)
      return if @citations.empty?

      pdf.move_down 14
      divider(pdf)
      pdf.text "AUDIT CITATIONS (#{@citations.length})",
               size: 9, style: :bold, color: "8a9ba8"
      pdf.move_down 4
      @citations.each_with_index do |id, i|
        pdf.text "#{i + 1}.  #{id}", size: 8, color: "5c7080"
      end
    end

    # ── helpers ───────────────────────────────────────────────────────────────

    def section_header(pdf, text)
      pdf.text text, size: 12, style: :bold, color: "1a2332"
      pdf.move_down 8
    end

    def divider(pdf)
      pdf.stroke_color "e1e8ed"
      pdf.stroke_horizontal_rule
      pdf.stroke_color "000000"
      pdf.move_down 14
    end
  end
end
