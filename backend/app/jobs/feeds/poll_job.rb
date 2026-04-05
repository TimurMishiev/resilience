module Feeds
  # Unified feed-polling job for all external data sources. Dispatches to the
  # appropriate ingestion service based on the +feed_name+ argument.
  #
  # Replaces the boot-time thread architecture in config/initializers/feed_ingestion.rb.
  # Benefits over threads:
  #   - Job-level retry with exponential backoff (ActiveJob retry_on)
  #   - Observability through Solid Queue's jobs table (pending, failed, completed)
  #   - No thread-per-feed connection pool pressure
  #   - Consistent scheduling that survives process restarts
  #
  # Scheduling: each feed is configured as a Solid Queue recurring task in
  # config/recurring.yml with its own interval. See that file for schedules.
  #
  # Credential gating: feeds that require API keys (AIS, FIRMS, ACLED) are
  # silently skipped when credentials are absent, recording a "disabled" status
  # in OperationalStatus for the feed health dashboard.
  class PollJob < ApplicationJob
    queue_as :background

    FEED_REGISTRY = {
      "opensky" => {
        service: "Feeds::OpenSkyIngestionService",
      },
      "usgs" => {
        service: "Feeds::UsgsSeismicIngestionService",
      },
      "gpsjam" => {
        service: "Feeds::GpsjamIngestionService",
      },
      "ais" => {
        service: "Feeds::AisIngestionService",
        required_env: %w[AISHUB_USERNAME],
      },
      "firms" => {
        service: "Feeds::FirmsWildfireIngestionService",
        required_env: %w[NASA_FIRMS_MAP_KEY],
      },
      "gdacs" => {
        service: "Feeds::GdacsIngestionService",
      },
      "acled" => {
        service: "Feeds::AcledIngestionService",
        required_env: %w[ACLED_API_KEY ACLED_EMAIL],
      },
    }.freeze

    # Retry transient network errors up to 5 times with polynomial backoff
    # (10s, 40s, 90s, 160s, 250s). If all attempts fail the job is discarded —
    # the next recurring schedule fires a fresh attempt.
    # Programming bugs (NoMethodError, etc.) are NOT retried — they fail immediately.
    Feeds::TransientErrors::CLASSES.each do |klass|
      retry_on klass, wait: :polynomially_longer, attempts: 5
    end
    discard_on ActiveJob::DeserializationError

    def perform(feed_name)
      config = FEED_REGISTRY[feed_name]
      unless config
        Rails.logger.error "[Feeds::PollJob] unknown feed: #{feed_name}"
        return
      end

      # Skip feeds with missing credentials
      if (required = config[:required_env])
        missing = required.select { |key| ENV[key].blank? }
        if missing.any?
          Feeds::PollMetrics.record_disabled(
            feed: feed_name,
            errors: missing.map { |k| "#{k} not configured" }
          )
          return
        end
      end

      result = config[:service].constantize.call

      if result.success
        count = result.payload[:ingested].to_i
        Rails.logger.info "[Feeds::PollJob] feed=#{feed_name} ingested=#{count}" if count > 0
      else
        Rails.logger.warn "[Feeds::PollJob] feed=#{feed_name} errors: #{result.errors.join(', ')}"
      end
    end
  end
end
