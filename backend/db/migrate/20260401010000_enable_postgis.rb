class EnablePostgis < ActiveRecord::Migration[8.0]
  # No-op when PostGIS is not installed on the Postgres instance.
  # Enables the extension on instances where it is available (Fly.io production,
  # CI with postgis, upgraded local dev). The geography migration that follows
  # checks for PostGIS availability the same way.
  def up
    if postgis_available?
      enable_extension "postgis"
      say "PostGIS enabled"
    else
      say "PostGIS extension not available on this instance — skipping. " \
          "Install PostGIS and re-run to enable spatial indexing.", true
    end
  end

  def down
    disable_extension "postgis" if extension_enabled?("postgis")
  end

  private

  def postgis_available?
    result = execute("SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'postgis'")
    result.first["count"].to_i > 0
  end
end
