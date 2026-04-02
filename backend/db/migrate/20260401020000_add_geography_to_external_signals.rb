class AddGeographyToExternalSignals < ActiveRecord::Migration[8.0]
  # Adds a PostGIS geography(Point, 4326) column to external_signals and a
  # GIST spatial index. Replaces the bounding-box + Ruby Haversine proximity
  # pattern with server-side ST_DWithin geography queries.
  #
  # Uses raw SQL for the column definition to avoid a dependency on the
  # activerecord-postgis-adapter / rgeo gems. The column is still fully usable
  # via raw SQL queries and the near_point scope on ExternalSignal.
  #
  # The near_point scope checks column_names at runtime and falls back to
  # bounding-box behaviour when the column is absent, so the app functions on
  # both plain-PostgreSQL and PostGIS instances.
  #
  # No-op when PostGIS is not enabled — safe to run on dev machines without
  # PostGIS. Re-run after enabling PostGIS to apply the column and index.
  def up
    unless extension_enabled?("postgis")
      say "PostGIS not enabled — skipping geography column. " \
          "Run db:migrate again after enabling PostGIS.", true
      return
    end

    execute <<~SQL
      ALTER TABLE external_signals
      ADD COLUMN location geography(Point, 4326)
    SQL

    execute <<~SQL
      CREATE INDEX idx_external_signals_location_gist
      ON external_signals USING GIST (location)
    SQL

    # Backfill all existing rows.
    execute <<~SQL
      UPDATE external_signals
      SET location = ST_SetSRID(
        ST_MakePoint(lng::double precision, lat::double precision), 4326
      )
      WHERE lat IS NOT NULL AND lng IS NOT NULL
    SQL

    # Trigger: keeps location in sync with lat/lng on every INSERT or UPDATE.
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

      CREATE TRIGGER trg_sync_external_signal_location
      BEFORE INSERT OR UPDATE OF lat, lng ON external_signals
      FOR EACH ROW EXECUTE FUNCTION sync_external_signal_location();
    SQL

    say "PostGIS geography column, GIST index, and sync trigger added."
  end

  def down
    return unless extension_enabled?("postgis")

    execute "DROP TRIGGER IF EXISTS trg_sync_external_signal_location ON external_signals"
    execute "DROP FUNCTION IF EXISTS sync_external_signal_location()"
    execute "DROP INDEX IF EXISTS idx_external_signals_location_gist"
    execute "ALTER TABLE external_signals DROP COLUMN IF EXISTS location"
  end
end
