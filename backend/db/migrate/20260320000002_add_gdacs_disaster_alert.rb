class AddGdacsDisasterAlert < ActiveRecord::Migration[8.1]
  # Extends the external_signals check constraints to allow the GDACS disaster
  # alert feed — new source "gdacs" and new signal_type "disaster_alert".
  #
  # GDACS (Global Disaster Alerting and Coordination System) is a UN-operated
  # framework that provides near-real-time alerts for earthquakes, floods,
  # tropical cyclones, tsunamis, volcanoes, and droughts. Fully public, no key.
  # https://www.gdacs.org/
  #
  # Pattern mirrors 20260320000001_add_acled_conflict_event:
  # drop named constraints and recreate with the extended value set in one
  # transaction so the table is never in an inconsistent state.
  def up
    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_source_check,
        ADD CONSTRAINT signals_source_check
          CHECK (source = ANY (ARRAY[
            'opensky', 'ais', 'usgs_seismic', 'gpsjam',
            'firms_wildfire', 'manual', 'derived', 'acled', 'gdacs'
          ]::text[]));
    SQL

    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_signal_type_check,
        ADD CONSTRAINT signals_signal_type_check
          CHECK (signal_type = ANY (ARRAY[
            'aircraft_position', 'vessel_position', 'seismic_event',
            'gps_jamming', 'wildfire', 'manual', 'ais_gap',
            'conflict_event', 'disaster_alert'
          ]::text[]));
    SQL
  end

  def down
    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_source_check,
        ADD CONSTRAINT signals_source_check
          CHECK (source = ANY (ARRAY[
            'opensky', 'ais', 'usgs_seismic', 'gpsjam',
            'firms_wildfire', 'manual', 'derived', 'acled'
          ]::text[]));
    SQL

    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_signal_type_check,
        ADD CONSTRAINT signals_signal_type_check
          CHECK (signal_type = ANY (ARRAY[
            'aircraft_position', 'vessel_position', 'seismic_event',
            'gps_jamming', 'wildfire', 'manual', 'ais_gap', 'conflict_event'
          ]::text[]));
    SQL
  end
end
