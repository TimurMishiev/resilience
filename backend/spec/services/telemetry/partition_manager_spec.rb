require "rails_helper"

RSpec.describe Telemetry::PartitionManager do
  let!(:asset) { create(:asset) }

  describe ".ensure_window!" do
    it "creates daily telemetry partitions for the requested window" do
      described_class.ensure_window!(Time.utc(2026, 3, 24, 12), days_back: 1, days_ahead: 1)

      expect(partition_names).to include(
        "telemetry_readings_p20260323",
        "telemetry_readings_p20260324",
        "telemetry_readings_p20260325"
      )
    end

    it "routes writes into the matching daily partition" do
      occurred_at = Time.utc(2026, 3, 24, 12)
      described_class.ensure_window!(occurred_at, days_ahead: 0)

      reading = TelemetryReading.create!(
        asset: asset,
        lat: 37.7749,
        lng: -122.4194,
        occurred_at: occurred_at,
        created_at: occurred_at
      )

      table_name = ActiveRecord::Base.connection.select_value(<<~SQL)
        SELECT tableoid::regclass::text
        FROM telemetry_readings
        WHERE id = #{ActiveRecord::Base.connection.quote(reading.id)}
      SQL

      expect(table_name).to eq("telemetry_readings_p20260324")
    end

    it "recreates a cached partition when the cache is stale but the table is missing" do
      occurred_at = Time.utc(2030, 1, 1, 12)
      partition_name = "telemetry_readings_p20300101"

      ActiveRecord::Base.connection.execute(<<~SQL)
        DROP TABLE IF EXISTS #{ActiveRecord::Base.connection.quote_table_name(partition_name)}
      SQL
      described_class.send(:cached_partitions)[partition_name] = true

      described_class.ensure_window!(occurred_at, days_ahead: 0)
      expect(partition_names).to include(partition_name)

      expect do
        TelemetryReading.create!(
          asset: asset,
          lat: 37.7749,
          lng: -122.4194,
          occurred_at: occurred_at,
          created_at: occurred_at
        )
      end.not_to raise_error
    end
  end

  describe ".prune_expired!" do
    it "drops partitions older than the retention cutoff" do
      described_class.ensure_window!(Time.utc(2026, 3, 20, 12), days_ahead: 0)
      described_class.ensure_window!(Time.utc(2026, 3, 24, 12), days_ahead: 0)

      described_class.prune_expired!(reference_time: Time.utc(2026, 3, 24, 12), retention_days: 2)

      expect(partition_names).not_to include("telemetry_readings_p20260320")
      expect(partition_names).to include("telemetry_readings_p20260324")
    end
  end

  def partition_names
    ActiveRecord::Base.connection.select_values(<<~SQL)
      SELECT child.relname
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      WHERE parent.relname = 'telemetry_readings'
      ORDER BY child.relname
    SQL
  end
end
