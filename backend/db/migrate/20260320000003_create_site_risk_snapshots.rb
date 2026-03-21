class CreateSiteRiskSnapshots < ActiveRecord::Migration[8.1]
  # Stores periodic point-in-time risk score snapshots per site.
  # Written by Risk::SnapshotJob (SolidQueue recurring, every hour).
  # Powers the risk score trend chart on the Site Detail page.
  #
  # Retention: Risk::SnapshotJob prunes rows older than 90 days on each run.
  # Index on [site_id, recorded_at] supports both the history query
  # (WHERE site_id = ? ORDER BY recorded_at ASC) and the pruning query.
  def change
    create_table :site_risk_snapshots, id: :uuid, default: "gen_random_uuid()" do |t|
      t.references :site, null: false, foreign_key: true, type: :uuid

      t.integer :score,        null: false
      t.string  :risk_level,   null: false

      t.decimal :alert_pressure,  precision: 5, scale: 2, null: false
      t.decimal :task_health,     precision: 5, scale: 2, null: false
      t.decimal :signal_density,  precision: 5, scale: 2, null: false

      t.datetime :recorded_at, null: false

      t.timestamps
    end

    add_index :site_risk_snapshots, [ :site_id, :recorded_at ]
  end
end
