module Sse
  # Deletes expired SseStreamLease rows to keep the table bounded.
  #
  # Runs every 5 minutes via SolidQueue (see config/recurring.yml).
  #
  # In the happy path, leases are released explicitly when the SSE connection
  # closes. This job handles the residual cases: crashed Puma threads, client
  # disconnects that weren't caught in ensure, and deploy restarts that leave
  # orphaned rows behind.
  class LeaseCleanupJob < ApplicationJob
    queue_as :background

    def perform
      deleted = SseStreamLease.expired_at(Time.current).delete_all
      Rails.logger.info "[Sse::LeaseCleanup] deleted #{deleted} expired lease(s)" if deleted.positive?
    end
  end
end
