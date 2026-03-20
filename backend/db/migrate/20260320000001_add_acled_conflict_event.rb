class AddAcledConflictEvent < ActiveRecord::Migration[8.1]
  # Extends the external_signals check constraints to allow the ACLED conflict
  # events feed — new source "acled" and new signal_type "conflict_event".
  #
  # ACLED (Armed Conflict Location & Event Data Project) provides free, geolocated
  # data on armed conflicts, battles, explosions, and political violence globally.
  # Free API registration at https://developer.acleddata.com/
  #
  # Pattern mirrors 20260318030002_add_derived_signal_types:
  # drop named constraints and recreate with the extended value set in one
  # transaction so the table is never in an inconsistent state.
  def up
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

  def down
    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_source_check,
        ADD CONSTRAINT signals_source_check
          CHECK (source = ANY (ARRAY[
            'opensky', 'ais', 'usgs_seismic', 'gpsjam',
            'firms_wildfire', 'manual', 'derived'
          ]::text[]));
    SQL

    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_signal_type_check,
        ADD CONSTRAINT signals_signal_type_check
          CHECK (signal_type = ANY (ARRAY[
            'aircraft_position', 'vessel_position', 'seismic_event',
            'gps_jamming', 'wildfire', 'manual', 'ais_gap'
          ]::text[]));
    SQL
  end
end
