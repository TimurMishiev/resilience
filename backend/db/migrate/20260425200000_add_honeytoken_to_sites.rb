class AddHoneytokenToSites < ActiveRecord::Migration[8.1]
  # Honeytoken flag on sites — plant a fake-but-realistic Site
  # record, mark honeytoken=true, and any read of that record via
  # Api::SitesController#show fires an alert through
  # ThreatDetection::HoneytokenAlertService (Tranche 4A,
  # ADR-009 item 7 partial-CLOSED).
  #
  # Why a column rather than a separate honeytokens table:
  #   - The flag is queried on every site read, so a JOIN would be
  #     hot-path overhead.
  #   - Honeytokens must look identical to real sites at the API
  #     surface (otherwise an attacker can fingerprint them); a
  #     separate table would tempt callers to filter them out.
  #   - The column default is false, so existing rows are
  #     unaffected and the migration is rewrite-free in PG11+.
  def change
    add_column :sites, :honeytoken, :boolean, default: false, null: false
  end
end
