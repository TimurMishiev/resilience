class CreateAuditEvents < ActiveRecord::Migration[8.1]
  def change
    create_table :audit_events, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.integer :schema_version, null: false, default: 1
      t.text :actor, null: false
      t.text :entity_type, null: false
      t.uuid :entity_id, null: false
      t.text :event_type, null: false
      t.text :action
      t.jsonb :before_snapshot
      t.jsonb :after_snapshot, null: false
      t.jsonb :metadata
      t.uuid :correlation_id, null: false
      t.datetime :occurred_at, precision: 6, null: false, default: -> { "now()" }
    end

    # Primary query pattern: fetch all events for a given entity ordered by time
    add_index :audit_events, [ :entity_type, :entity_id, :occurred_at ]

    # Replay query pattern: fetch all events up to a given timestamp
    add_index :audit_events, :occurred_at

    # Correlation grouping: fetch all events from a single operation
    add_index :audit_events, :correlation_id
  end
end
