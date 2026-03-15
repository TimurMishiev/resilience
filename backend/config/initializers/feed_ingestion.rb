# Starts the OpenSky feed ingestion background thread after Rails has fully booted.
# Polls live aircraft positions every 60 seconds across 4 geographic bounding boxes.
# Skipped in test mode, rake tasks, and Rails console.
unless Rails.env.test? || defined?(Rails::Console) || File.basename($PROGRAM_NAME) == "rake"
  Rails.application.config.after_initialize do
    Thread.new do
      Thread.current.name = "opensky-feed"
      Rails.logger.info "[OpenSkyFeed] started — polling every 60s"

      loop do
        begin
          result = Feeds::OpenSkyIngestionService.call
          if result.success
            count = result.payload[:ingested]
            Rails.logger.info "[OpenSkyFeed] ingested #{count} new signals" if count > 0
          else
            Rails.logger.warn "[OpenSkyFeed] ingestion errors: #{result.errors.join(', ')}"
          end
        rescue ActiveRecord::StatementInvalid, PG::Error => e
          Rails.logger.error "[OpenSkyFeed] DB error: #{e.message}"
          sleep 30
          next
        rescue => e
          Rails.logger.error "[OpenSkyFeed] unexpected error: #{e.message}"
        end

        sleep 60
      end
    end
  end
end
