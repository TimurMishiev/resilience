class AddDerivedSignalTypes < ActiveRecord::Migration[8.1]
  # Extends the external_signals check constraints to allow derived signal types.
  #
  # "derived" source: signals synthesized by background jobs (gap detection,
  # loitering detection, route deviation) rather than ingested from external APIs.
  #
  # "ais_gap" signal_type: synthesized when a vessel's AIS transponder goes dark
  # for longer than the gap detection threshold.
  #
  # Why alter constraints instead of dropping them?
  # The constraints are named — we drop by name and recreate with the new set.
  # This is safer than DROP CONSTRAINT + ADD CONSTRAINT in separate statements
  # because both happen in one transaction.
  def up
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

  def down
    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_source_check,
        ADD CONSTRAINT signals_source_check
          CHECK (source = ANY (ARRAY[
            'opensky', 'ais', 'usgs_seismic', 'gpsjam', 'firms_wildfire', 'manual'
          ]::text[]));
    SQL

    execute <<~SQL
      ALTER TABLE external_signals
        DROP CONSTRAINT signals_signal_type_check,
        ADD CONSTRAINT signals_signal_type_check
          CHECK (signal_type = ANY (ARRAY[
            'aircraft_position', 'vessel_position', 'seismic_event',
            'gps_jamming', 'wildfire', 'manual'
          ]::text[]));
    SQL
  end
end
