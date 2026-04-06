class AddUniqueIndexOnSignalRuleMatchesForRuleFirings < ActiveRecord::Migration[8.0]
  # Prevents duplicate SignalRuleMatch rows for the same signal + rule pair.
  # Duplicate rows can occur when a job retries or is enqueued twice, creating
  # phantom duplicate alerts, tasks, and SSE events.
  #
  # A partial index (WHERE correlation_rule_id IS NOT NULL) is used because
  # geofence-breach matches have correlation_rule_id = NULL and are already
  # covered by idx_geofence_breach_signal_site_unique.
  def change
    add_index :signal_rule_matches,
              [:signal_id, :correlation_rule_id],
              unique: true,
              where: "correlation_rule_id IS NOT NULL",
              name: "idx_rule_match_signal_rule_unique"
  end
end
