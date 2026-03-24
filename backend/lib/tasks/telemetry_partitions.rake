namespace :telemetry do
  desc "Pre-create telemetry partitions around the current time"
  task :prepare_partitions, %i[days_back days_ahead] => :environment do |_, args|
    days_back = args[:days_back].present? ? args[:days_back].to_i : 1
    days_ahead = args[:days_ahead].present? ? args[:days_ahead].to_i : Telemetry::PartitionManager::LOOKAHEAD_DAYS

    Telemetry::PartitionManager.ensure_window!(Time.current, days_back: days_back, days_ahead: days_ahead)
  end

  desc "Drop telemetry partitions older than the retention window"
  task :prune_partitions, [:retention_days] => :environment do |_, args|
    retention_days = args[:retention_days].present? ? args[:retention_days].to_i : Telemetry::PartitionManager.default_retention_days

    Telemetry::PartitionManager.prune_expired!(retention_days: retention_days)
  end
end
