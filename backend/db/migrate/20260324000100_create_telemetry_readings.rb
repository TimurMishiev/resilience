class CreateTelemetryReadings < ActiveRecord::Migration[8.1]
  def change
    create_table :telemetry_readings, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.uuid     :asset_id,   null: false
      t.float    :lat,        null: false
      t.float    :lng,        null: false
      t.float    :speed
      t.float    :heading
      t.float    :battery
      t.datetime :occurred_at, precision: 6, null: false
      t.datetime :created_at,  precision: 6, null: false, default: -> { "now()" }
    end

    add_index :telemetry_readings, :occurred_at
    add_index :telemetry_readings, %i[asset_id occurred_at],
              order: { occurred_at: :desc },
              name: "index_telemetry_readings_on_asset_id_and_occurred_at"
    add_foreign_key :telemetry_readings, :assets, column: :asset_id, on_delete: :cascade
  end
end
