class AddGeographyToSites < ActiveRecord::Migration[8.0]
  # Adds a PostGIS geography(Point, 4326) column to sites and a GIST spatial
  # index. Mirrors the pattern applied to external_signals.
  #
  # Use case: future "find all sites near a point" queries (e.g. area-of-effect
  # incident queries, proximity-based AO assignment, spatial dashboard filters).
  # Currently all proximity logic runs signals → sites, so this column is
  # forward-looking rather than immediately critical.
  #
  # No-op when PostGIS is not enabled — safe on plain-PostgreSQL dev instances.
  def up
    unless extension_enabled?("postgis")
      say "PostGIS not enabled — skipping sites geography column.", true
      return
    end

    execute <<~SQL
      ALTER TABLE sites
      ADD COLUMN location geography(Point, 4326)
    SQL

    execute <<~SQL
      CREATE INDEX idx_sites_location_gist
      ON sites USING GIST (location)
    SQL

    execute <<~SQL
      UPDATE sites
      SET location = ST_SetSRID(
        ST_MakePoint(longitude::double precision, latitude::double precision), 4326
      )
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    SQL

    execute <<~SQL
      CREATE OR REPLACE FUNCTION sync_site_location()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
          NEW.location := ST_SetSRID(
            ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision), 4326
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_sync_site_location
      BEFORE INSERT OR UPDATE OF latitude, longitude ON sites
      FOR EACH ROW EXECUTE FUNCTION sync_site_location();
    SQL

    say "Sites geography column, GIST index, backfill, and sync trigger added."
  end

  def down
    return unless extension_enabled?("postgis")

    execute "DROP TRIGGER IF EXISTS trg_sync_site_location ON sites"
    execute "DROP FUNCTION IF EXISTS sync_site_location()"
    execute "DROP INDEX IF EXISTS idx_sites_location_gist"
    execute "ALTER TABLE sites DROP COLUMN IF EXISTS location"
  end
end
