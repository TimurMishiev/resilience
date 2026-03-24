class PartitionTelemetryReadingsByOccurredAt < ActiveRecord::Migration[8.1]
  PARTITION_LOOKAHEAD_DAYS = 7
  PARTITION_LOOKBACK_DAYS = 1

  def up
    rename_table :telemetry_readings, :telemetry_readings_legacy

    create_partitioned_table!
    create_partitions_for!(partition_window_for_legacy_data)
    migrate_legacy_rows!
    drop_table :telemetry_readings_legacy, force: :cascade
    add_partitioned_indexes_and_foreign_key!
  end

  def down
    rename_table :telemetry_readings, :telemetry_readings_partitioned

    create_heap_table!
    migrate_partitioned_rows!
    add_heap_indexes_and_foreign_key!
    drop_table :telemetry_readings_partitioned, force: :cascade
  end

  private

  def create_partitioned_table!
    execute <<~SQL
      CREATE TABLE telemetry_readings (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        asset_id uuid NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        speed double precision,
        heading double precision,
        battery double precision,
        occurred_at timestamp(6) without time zone NOT NULL,
        created_at timestamp(6) without time zone DEFAULT now() NOT NULL
      ) PARTITION BY RANGE (occurred_at)
    SQL
  end

  def create_heap_table!
    execute <<~SQL
      CREATE TABLE telemetry_readings (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        asset_id uuid NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        speed double precision,
        heading double precision,
        battery double precision,
        occurred_at timestamp(6) without time zone NOT NULL,
        created_at timestamp(6) without time zone DEFAULT now() NOT NULL,
        CONSTRAINT telemetry_readings_pkey PRIMARY KEY (id)
      )
    SQL
  end

  def partition_window_for_legacy_data
    legacy_min = coerce_date(select_value("SELECT MIN(occurred_at)::date FROM telemetry_readings_legacy"))
    legacy_max = coerce_date(select_value("SELECT MAX(occurred_at)::date FROM telemetry_readings_legacy"))

    today = Time.current.utc.to_date
    start_date = [legacy_min || today, today - PARTITION_LOOKBACK_DAYS].min
    end_date = [legacy_max || today, today + PARTITION_LOOKAHEAD_DAYS].max

    start_date..end_date
  end

  def create_partitions_for!(date_range)
    date_range.each do |date|
      partition_name = "telemetry_readings_p#{date.strftime('%Y%m%d')}"
      from_value = connection.quote(date.iso8601)
      to_value = connection.quote((date + 1).iso8601)

      execute <<~SQL
        CREATE TABLE #{connection.quote_table_name(partition_name)}
        PARTITION OF telemetry_readings
        FOR VALUES FROM (#{from_value}) TO (#{to_value})
      SQL
    end
  end

  def migrate_legacy_rows!
    execute <<~SQL
      INSERT INTO telemetry_readings (id, asset_id, lat, lng, speed, heading, battery, occurred_at, created_at)
      SELECT id, asset_id, lat, lng, speed, heading, battery, occurred_at, created_at
      FROM telemetry_readings_legacy
      ORDER BY occurred_at ASC
    SQL
  end

  def migrate_partitioned_rows!
    execute <<~SQL
      INSERT INTO telemetry_readings (id, asset_id, lat, lng, speed, heading, battery, occurred_at, created_at)
      SELECT id, asset_id, lat, lng, speed, heading, battery, occurred_at, created_at
      FROM telemetry_readings_partitioned
      ORDER BY occurred_at ASC
    SQL
  end

  def add_partitioned_indexes_and_foreign_key!
    execute <<~SQL
      CREATE INDEX index_telemetry_readings_on_occurred_at
      ON telemetry_readings USING brin (occurred_at)
    SQL

    execute <<~SQL
      CREATE INDEX index_telemetry_readings_on_asset_id_and_occurred_at
      ON telemetry_readings USING btree (asset_id, occurred_at DESC)
    SQL

    execute <<~SQL
      ALTER TABLE telemetry_readings
      ADD CONSTRAINT fk_rails_d477387a3c
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    SQL
  end

  def add_heap_indexes_and_foreign_key!
    execute <<~SQL
      CREATE INDEX index_telemetry_readings_on_occurred_at
      ON telemetry_readings USING btree (occurred_at)
    SQL

    execute <<~SQL
      CREATE INDEX index_telemetry_readings_on_asset_id_and_occurred_at
      ON telemetry_readings USING btree (asset_id, occurred_at DESC)
    SQL

    execute <<~SQL
      ALTER TABLE telemetry_readings
      ADD CONSTRAINT fk_rails_d477387a3c
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    SQL
  end

  def coerce_date(value)
    case value
    when Date
      value
    when String
      Date.parse(value)
    end
  end
end
