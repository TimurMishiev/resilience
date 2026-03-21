class AddUniqueIndexToPendingRecommendations < ActiveRecord::Migration[8.1]
  # Guarantees that only one *pending* recommendation can exist for a given
  # (recommendation_type, affected_entity_type, affected_entity_id) triple at
  # any point in time.  Uses a PostgreSQL partial unique index so that multiple
  # historical (accepted/rejected/deferred/executed/expired) records can coexist
  # for the same entity — only the live pending one is constrained.
  def change
    add_index :recommendations,
              %i[recommendation_type affected_entity_type affected_entity_id],
              name:   "idx_recommendations_pending_dedup",
              unique: true,
              where:  "status = 'pending'"
  end
end
