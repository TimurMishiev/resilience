# frozen_string_literal: true

module Metrics
  # Persists accumulated platform metrics to OperationalStatus every 60 seconds.
  # Runs as a Solid Queue recurring job — see config/recurring.yml.
  class SnapshotJob < ApplicationJob
    queue_as :background

    def perform
      Metrics::Recorder.snapshot!
      Rails.logger.info "[Metrics::SnapshotJob] metrics snapshot persisted"
    end
  end
end
