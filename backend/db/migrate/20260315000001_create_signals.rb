class CreateSignals < ActiveRecord::Migration[8.1]
  def change
    create_table :signals, id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
      t.text :source,      null: false
      t.text :signal_type, null: false
      t.text :external_id, null: false
      t.decimal :lat,       precision: 9, scale: 6, null: false
      t.decimal :lng,       precision: 9, scale: 6, null: false
      t.decimal :altitude,  precision: 10, scale: 2
      t.decimal :speed,     precision: 8,  scale: 2
      t.decimal :heading,   precision: 6,  scale: 2
      t.decimal :magnitude, precision: 5,  scale: 2
      t.jsonb   :raw_payload, null: false, default: {}
      t.datetime :occurred_at, precision: 6, null: false
      t.datetime :ingested_at, precision: 6, null: false, default: -> { "now()" }
    end

    add_index :signals, %i[source external_id occurred_at], unique: true,
              name: "index_signals_on_dedup"
    add_index :signals, :occurred_at
    add_index :signals, :source
    add_index :signals, %i[lat lng]

    execute <<~SQL
      ALTER TABLE signals ADD CONSTRAINT signals_source_check CHECK (source IN (
        'opensky','ais','usgs_seismic','gpsjam','firms_wildfire','manual'
      ));
      ALTER TABLE signals ADD CONSTRAINT signals_signal_type_check CHECK (signal_type IN (
        'aircraft_position','vessel_position','seismic_event',
        'gps_jamming','wildfire','manual'
      ));
    SQL
  end
end
