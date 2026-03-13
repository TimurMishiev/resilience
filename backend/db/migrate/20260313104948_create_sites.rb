class CreateSites < ActiveRecord::Migration[8.1]
  def change
    create_table :sites, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.text :name, null: false
      t.decimal :latitude, precision: 9, scale: 6, null: false
      t.decimal :longitude, precision: 9, scale: 6, null: false
      t.text :status, null: false, default: "active"
      t.timestamps null: false
    end
  end
end
