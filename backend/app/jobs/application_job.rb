class ApplicationJob < ActiveJob::Base
  # Global retry / discard baseline for every background job.
  #
  # Subclasses can layer additional retry_on / discard_on calls on top
  # of this baseline (see Feeds::PollJob, Incidents::FusionJob,
  # Vessels::TrackRetentionJob for examples). The first matching policy
  # wins, so a subclass-level policy for the same exception class
  # overrides this one.
  #
  # Retry policies (transient infra — retry with backoff, then dead-letter):
  #
  #   - ActiveRecord::Deadlocked: Postgres serialisation conflict.
  #     Almost always self-resolves on retry. Polynomial backoff caps
  #     the contribution to overall queue latency if we ever hit a
  #     hot-row deadlock storm.
  #   - ActiveRecord::ConnectionTimeoutError: connection pool
  #     exhausted. Backing off lets the pool recover before reattempt;
  #     5 attempts because pool exhaustion can take a few seconds to
  #     clear under load (telemetry SSE + recommendation generation
  #     are the realistic contention sources).
  #
  # Discard policies (unrecoverable shapes — drop and don't retry):
  #
  #   - ActiveJob::DeserializationError: the record referenced in the
  #     enqueued args was deleted before the job ran. Retrying cannot
  #     recover the missing record; we drop silently. Several
  #     subclasses redundantly declare this themselves; the
  #     parent-level discard means a job that forgets is still safe.
  #   - ActiveRecord::RecordNotFound: same shape as above but raised
  #     inside perform() rather than at deserialisation. Discard so
  #     the recurring schedule (most jobs) can re-trigger fresh
  #     without filling the failure table with permanent dead-ends.
  #
  # Idempotency expectation: every job MUST be safe to run more than
  # once. Retries above mean a partially-completed job that raised
  # halfway through will be re-invoked from the start. Domain
  # invariants (unique indexes, advisory locks, atomic UPDATE ... WHERE,
  # transactional outbox) carry the actual idempotency contract; this
  # baseline only guarantees the retry path is safe to take. New jobs
  # that cannot be made idempotent must override perform() with an
  # explicit guard rather than rely on the baseline.
  retry_on ActiveRecord::Deadlocked,             wait: :polynomially_longer, attempts: 3
  retry_on ActiveRecord::ConnectionTimeoutError, wait: :polynomially_longer, attempts: 5

  discard_on ActiveJob::DeserializationError
  discard_on ActiveRecord::RecordNotFound
end
