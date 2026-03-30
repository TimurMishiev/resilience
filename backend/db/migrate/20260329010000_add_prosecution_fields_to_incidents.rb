class AddProsecutionFieldsToIncidents < ActiveRecord::Migration[8.0]
  def change
    add_column :incidents, :prosecution_phase,          :string,   null: true
    add_column :incidents, :prosecuted_by_id,           :uuid,     null: true
    add_column :incidents, :prosecution_initiated_at,   :datetime, null: true

    add_foreign_key :incidents, :users, column: :prosecuted_by_id

    add_index :incidents, :prosecution_phase,
              where: "prosecution_phase IS NOT NULL",
              name:  "idx_incidents_active_prosecution"
  end
end
