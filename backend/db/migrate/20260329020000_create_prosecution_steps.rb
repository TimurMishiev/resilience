class CreateProsecutionSteps < ActiveRecord::Migration[8.0]
  def change
    create_table :prosecution_steps, id: :uuid do |t|
      t.references :incident, null: false, foreign_key: true, type: :uuid
      t.references :actor,    null: false, foreign_key: { to_table: :users }, type: :uuid

      t.string   :phase,       null: false
      t.string   :action_type, null: false
      t.text     :notes
      t.jsonb    :evidence_refs, null: false, default: {}

      # occurred_at is the authoritative timestamp for ordering and display.
      # created_at is the DB insertion timestamp — typically identical but may
      # differ if steps are imported or backdated.
      t.datetime :occurred_at, null: false, default: -> { "NOW()" }
      t.datetime :created_at,  null: false, default: -> { "NOW()" }
    end

    # Primary read pattern: all steps for a given incident, oldest-first.
    add_index :prosecution_steps, %i[incident_id occurred_at],
              name: "idx_prosecution_steps_incident_time"

    # Support filtering steps by phase (e.g., "show me all executing steps").
    add_index :prosecution_steps, %i[incident_id phase],
              name: "idx_prosecution_steps_incident_phase"
  end
end
