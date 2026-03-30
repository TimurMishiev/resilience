class CreateOperationalStatuses < ActiveRecord::Migration[8.0]
  def change
    create_table :operational_statuses do |t|
      t.string :category, null: false
      t.string :key, null: false
      t.jsonb :payload, null: false, default: {}

      t.timestamps
    end

    add_index :operational_statuses, %i[category key],
              unique: true,
              name: "idx_operational_statuses_category_key"
  end
end
