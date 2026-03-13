class CreateAssets < ActiveRecord::Migration[8.1]
  def change
    create_table :assets, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.text :name, null: false
      t.text :asset_type, null: false
      t.text :status, null: false, default: "available"
      t.references :home_site, type: :uuid, null: true, foreign_key: { to_table: :sites }
      t.timestamps null: false
    end
  end
end
