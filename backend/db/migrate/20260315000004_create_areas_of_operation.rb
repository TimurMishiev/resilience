class CreateAreasOfOperation < ActiveRecord::Migration[8.1]
  def change
    create_table :areas_of_operation, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.text     :name,         null: false
      t.text     :description
      t.text     :threat_level, null: false, default: "green"
      t.text     :color,        null: false, default: "#23d160"
      t.jsonb    :geometry,     null: false, default: {}
      t.references :created_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.timestamps null: false
    end

    add_check_constraint :areas_of_operation,
      "threat_level IN ('green', 'amber', 'red', 'black')",
      name: "areas_of_operation_threat_level_check"

    add_index :areas_of_operation, :threat_level, name: "index_ao_on_threat_level"
  end
end
