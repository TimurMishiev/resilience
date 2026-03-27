class CreatePlanningDoctrineRecords < ActiveRecord::Migration[8.1]
  def change
    create_table :commander_intents, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :area_of_operation, null: false, type: :uuid, foreign_key: { to_table: :areas_of_operation }, index: { unique: true }
      t.references :created_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.references :updated_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.string :title, null: false
      t.text :objective, null: false
      t.text :end_state, null: false
      t.text :constraints

      t.timestamps
    end

    create_table :pace_plans, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :area_of_operation, null: false, type: :uuid, foreign_key: { to_table: :areas_of_operation }, index: { unique: true }
      t.references :created_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.references :updated_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.text :primary_plan, null: false
      t.text :alternate_plan, null: false
      t.text :contingency_plan, null: false
      t.text :emergency_plan, null: false
      t.text :notes

      t.timestamps
    end

    create_table :salute_reports, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :area_of_operation, null: false, type: :uuid, foreign_key: { to_table: :areas_of_operation }
      t.references :site, type: :uuid, foreign_key: true
      t.references :created_by, null: false, type: :uuid, foreign_key: { to_table: :users }
      t.string :size
      t.text :activity, null: false
      t.text :location, null: false
      t.string :unit
      t.datetime :observed_at, null: false
      t.text :equipment
      t.text :remarks

      t.timestamps
    end

    add_index :salute_reports, [:area_of_operation_id, :observed_at]
  end
end
