class AddFusionLookupIndexToIncidents < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  # Supports Incidents::FusionService's hot-path query:
  #   Incident.where(site_id:, status: ['open','acknowledged'])
  #           .where(updated_at: 6.hours.ago..Time.current)
  #           .order(updated_at: :desc).first
  #
  # Without this index PG must bitmap-AND site_id + status single-column
  # indexes and heap-fetch to filter updated_at. With many incidents per site
  # this degrades to a partial table scan on every rule/geofence match.
  def change
    add_index :incidents,
              [:site_id, :status, :updated_at],
              name: "index_incidents_fusion_lookup",
              where: "status IN ('open', 'acknowledged')",
              algorithm: :concurrently
  end
end
