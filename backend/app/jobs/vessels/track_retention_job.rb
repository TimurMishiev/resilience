module Vessels
  # Deletes vessel_tracks rows older than RETAIN_FOR to keep the table bounded.
  #
  # Runs on a schedule via SolidQueue (see config/recurring.yml).
  #
  # Why batch deletion?
  # Deleting millions of rows in a single DELETE statement holds a long-running
  # lock on the table and creates a large Postgres dead-tuple footprint that
  # VACUUM has to clean up later. Batching keeps each transaction small, releases
  # locks quickly, and gives Postgres time to autovacuum between batches.
  #
  # BATCH_SIZE of 1_000 is conservative — safe for production without tuning.
  # At higher volumes, increase to 5_000 and monitor autovacuum lag.
  class TrackRetentionJob < ApplicationJob
    queue_as :background

    RETAIN_FOR  = 7.days
    BATCH_SIZE  = 1_000

    def perform
      cutoff  = RETAIN_FOR.ago
      deleted = 0

      loop do
        batch = VesselTrack.older_than(RETAIN_FOR).limit(BATCH_SIZE).delete_all
        deleted += batch
        break if batch < BATCH_SIZE
      end

      Rails.logger.info "[TrackRetention] deleted #{deleted} rows older than #{cutoff}"
    end
  end
end
