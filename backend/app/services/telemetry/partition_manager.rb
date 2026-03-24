require "set"

module Telemetry
  class PartitionManager
    LOOKAHEAD_DAYS = 7
    DEFAULT_RETENTION_DAYS = 30
    ADVISORY_LOCK_NAMESPACE = 84_601

    class << self
      def ensure_window!(timestamp, days_back: 0, days_ahead: LOOKAHEAD_DAYS)
        return unless parent_table_exists?

        center = utc_date(timestamp)
        range_start = center - [days_back.to_i, 0].max
        range_end = center + [days_ahead.to_i, 0].max

        (range_start..range_end).each { |date| ensure_partition!(date) }
      end

      def prune_expired!(reference_time: Time.current, retention_days: default_retention_days)
        return if retention_days.nil?

        cutoff_date = utc_date(reference_time) - retention_days.to_i
        stale_partition_names(before_date: cutoff_date).each do |partition_name|
          connection.execute("DROP TABLE IF EXISTS #{connection.quote_table_name(partition_name)}")
          cached_partitions.delete(partition_name)
        end
      end

      def default_retention_days
        value = ENV["TELEMETRY_RETENTION_DAYS"]
        value.present? ? value.to_i : DEFAULT_RETENTION_DAYS
      end

      def partition_name_for(date)
        "telemetry_readings_p#{date.strftime('%Y%m%d')}"
      end

      private

      def ensure_partition!(date)
        partition_name = partition_name_for(date)
        return if cached_partitions.include?(partition_name)

        with_advisory_lock(lock_key_for(date)) do
          unless partition_exists?(partition_name)
            from_value = connection.quote(date.iso8601)
            to_value = connection.quote((date + 1).iso8601)

            connection.execute(<<~SQL)
              CREATE TABLE IF NOT EXISTS #{connection.quote_table_name(partition_name)}
              PARTITION OF telemetry_readings
              FOR VALUES FROM (#{from_value}) TO (#{to_value})
            SQL
          end
        end

        cached_partitions << partition_name
      end

      def partition_exists?(partition_name)
        connection.select_value(<<~SQL).present?
          SELECT 1
          FROM pg_class
          WHERE relname = #{connection.quote(partition_name)}
          LIMIT 1
        SQL
      end

      def stale_partition_names(before_date:)
        partition_names.select do |partition_name|
          partition_date = partition_date_for(partition_name)
          partition_date && partition_date < before_date
        end
      end

      def partition_names
        connection.select_values(<<~SQL)
          SELECT child.relname
          FROM pg_inherits
          JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
          JOIN pg_class child ON pg_inherits.inhrelid = child.oid
          WHERE parent.relname = 'telemetry_readings'
          ORDER BY child.relname
        SQL
      end

      def partition_date_for(partition_name)
        match = /\Atelemetry_readings_p(\d{8})\z/.match(partition_name)
        match ? Date.strptime(match[1], "%Y%m%d") : nil
      end

      def lock_key_for(date)
        date.strftime("%Y%m%d").to_i
      end

      def with_advisory_lock(lock_key)
        connection.execute("SELECT pg_advisory_lock(#{ADVISORY_LOCK_NAMESPACE}, #{lock_key})")
        yield
      ensure
        connection.execute("SELECT pg_advisory_unlock(#{ADVISORY_LOCK_NAMESPACE}, #{lock_key})")
      end

      def cached_partitions
        @cached_partitions ||= Set.new
      end

      def parent_table_exists?
        connection.data_source_exists?("telemetry_readings")
      end

      def utc_date(timestamp)
        timestamp.to_time.utc.to_date
      end

      def connection
        ActiveRecord::Base.connection
      end
    end
  end
end
