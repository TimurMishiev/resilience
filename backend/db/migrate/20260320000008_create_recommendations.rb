class CreateRecommendations < ActiveRecord::Migration[8.0]
  def change
    create_table :recommendations, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.string  :recommendation_type, null: false
      t.string  :status,              null: false, default: "pending"
      t.string  :tier,                null: false         # "rule" | "llm"
      t.float   :confidence,          null: false
      t.text    :rationale,           null: false
      t.jsonb   :evidence,            null: false, default: []
      t.jsonb   :action_payload,      null: false, default: {}
      t.string  :affected_entity_type
      t.uuid    :affected_entity_id
      t.uuid    :reviewed_by_id
      t.timestamp :reviewed_at
      t.text    :review_reason
      t.timestamp :executed_at
      t.timestamp :expires_at,        null: false
      t.timestamps
    end

    add_index :recommendations, :status
    add_index :recommendations, :recommendation_type
    add_index :recommendations, [:affected_entity_type, :affected_entity_id],
              name: "idx_recommendations_entity"
    add_index :recommendations, :expires_at
    add_foreign_key :recommendations, :users, column: :reviewed_by_id
  end
end
