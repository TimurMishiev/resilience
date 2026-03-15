class CreateCorrelationRules < ActiveRecord::Migration[8.1]
  def change
    create_table :correlation_rules, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.text    :name,             null: false
      t.text    :description
      t.boolean :is_active,        null: false, default: true
      t.jsonb   :conditions,       null: false, default: {}
      t.jsonb   :actions,          null: false, default: {}
      t.references :created_by, type: :uuid, null: false, foreign_key: { to_table: :users }
      t.integer :cooldown_minutes, null: false, default: 60
      t.datetime :last_fired_at,   precision: 6
      t.timestamps null: false
    end

    add_index :correlation_rules, :is_active
  end
end
