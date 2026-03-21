class CreateIncidents < ActiveRecord::Migration[8.0]
  def change
    create_table :incidents, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.text    :title,               null: false
      t.text    :description
      t.string  :status,              null: false, default: "open"
      t.string  :severity,            null: false, default: "moderate"
      t.float   :confidence,          null: false, default: 0.0
      t.uuid    :site_id
      t.uuid    :area_of_operation_id
      t.timestamp :opened_at,         null: false, default: -> { "NOW()" }
      t.timestamp :acknowledged_at
      t.timestamp :closed_at
      t.text    :fusion_rationale
      t.jsonb   :metadata,            null: false, default: {}
      t.timestamps
    end

    add_foreign_key :incidents, :sites,              column: :site_id
    add_foreign_key :incidents, :areas_of_operation, column: :area_of_operation_id

    add_index :incidents, :status
    add_index :incidents, :severity
    add_index :incidents, :opened_at
    add_index :incidents, :site_id

    add_column :signal_rule_matches, :incident_id, :uuid, null: true
    add_foreign_key :signal_rule_matches, :incidents, column: :incident_id
    add_index :signal_rule_matches, :incident_id
  end
end
