class ApplyPostgisGeographyToExternalSignals < ActiveRecord::Migration[8.0]
  # The original migration (20260401020000) was recorded as complete before
  # PostGIS was enabled, so it ran as a no-op.  This migration applies the
  # geography column, GIST index, backfill, and sync trigger that should
  # have been created then.  Each statement is idempotent — safe to run even
  # if parts were manually applied.
  def up
    unless extension_enabled?("postgis")
      say "PostGIS not enabled — skipping.", true
      return
    end

    # Column
    unless column_exists?(:external_signals, :location)
      execute <<~SQL
        ALTER TABLE external_signals
        ADD COLUMN location geography(Point, 4326)
      SQL
    end

    # GIST index
    unless index_exists?(:external_signals, :location, name: "idx_external_signals_location_gist")
      execute <<~SQL
        CREATE INDEX idx_external_signals_location_gist
        ON external_signals USING GIST (location)
      SQL
    end

    # Backfill existing rows
    execute <<~SQL
      UPDATE external_signals
      SET location = ST_SetSRID(
        ST_MakePoint(lng::double precision, lat::double precision), 4326
      )
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL
    SQL

    # Sync trigger (CREATE OR REPLACE is idempotent)
    execute <<~SQL
      CREATE OR REPLACE FUNCTION sync_external_signal_location()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
          NEW.location := ST_SetSRID(
            ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sync_external_signal_location ON external_signals;
      CREATE TRIGGER trg_sync_external_signal_location
      BEFORE INSERT OR UPDATE OF lat, lng ON external_signals
      FOR EACH ROW EXECUTE FUNCTION sync_external_signal_location();
    SQL

    say "PostGIS geography column, GIST index, and sync trigger applied."
  end

  def down
    return unless extension_enabled?("postgis")

    execute "DROP TRIGGER IF EXISTS trg_sync_external_signal_location ON external_signals"
    execute "DROP FUNCTION IF EXISTS sync_external_signal_location()"
    execute "DROP INDEX IF EXISTS idx_external_signals_location_gist"

    remove_column :external_signals, :location if column_exists?(:external_signals, :location)
  end
end
