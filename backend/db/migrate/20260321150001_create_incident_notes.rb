class CreateIncidentNotes < ActiveRecord::Migration[8.0]
  # Append-only operator notes on an incident.
  # Notes are immutable once created — the full history is the record.
  # Each note also writes an AuditEvent so it appears in the site timeline.
  def change
    create_table :incident_notes, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :incident, type: :uuid, null: false, foreign_key: true
      t.references :author,   type: :uuid, null: false, foreign_key: { to_table: :users }
      t.text       :body,     null: false
      t.timestamps null: false
    end

    add_index :incident_notes, :created_at
  end
end
