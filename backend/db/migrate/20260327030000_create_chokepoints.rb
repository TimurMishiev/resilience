class CreateChokepoints < ActiveRecord::Migration[8.1]
  def change
    create_table :chokepoints, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :area_of_operation, null: false, type: :uuid, foreign_key: { to_table: :areas_of_operation }
      t.references :created_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.references :updated_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.string :name, null: false
      t.string :category, null: false
      t.string :status, null: false
      t.decimal :latitude, null: false, precision: 10, scale: 6
      t.decimal :longitude, null: false, precision: 10, scale: 6
      t.decimal :watch_radius_km, null: false, precision: 6, scale: 2
      t.text :notes

      t.timestamps
    end

    add_index :chokepoints,
              "area_of_operation_id, lower(name)",
              unique: true,
              name: "index_chokepoints_on_ao_id_and_lower_name"
    add_index :chokepoints, [:area_of_operation_id, :status]
  end
end
