class AddUniqueIndexToGeofenceBreaches < ActiveRecord::Migration[8.0]
  # Guarantees at most one geofence-breach match per (signal, site) pair at the
  # database level.  The partial index only covers rows where correlation_rule_id
  # IS NULL — those are exclusively geofence-breach matches — so it has no impact
  # on ordinary correlation-rule matches.
  #
  # This makes GeofenceBreachService's idempotency contract DB-backed:
  # the application-level exists? guard is a fast-path optimisation; a concurrent
  # duplicate insert is absorbed by rescuing ActiveRecord::RecordNotUnique.
  def change
    add_index :signal_rule_matches,
              %i[signal_id site_id],
              unique: true,
              where:  "correlation_rule_id IS NULL",
              name:   "idx_geofence_breach_signal_site_unique"
  end
end
