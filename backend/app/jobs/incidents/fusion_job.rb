module Incidents
  # Transactional-outbox companion to RuleFiringService. The rule-firing
  # transaction enqueues this job (its row in solid_queue_jobs commits
  # atomically with the SignalRuleMatch row). When the transaction
  # commits, the job is durable and SolidQueue picks it up. If the
  # transaction rolls back, the job is never enqueued — no risk of
  # firing fusion against a non-existent match.
  #
  # Why this exists: RuleFiringService used to call FusionService.call
  # synchronously, outside the cooldown-claim transaction. A transient
  # FusionService failure (DB blip, lock contention) was caught by the
  # bottom rescue clause in RuleFiringService, logged, and silently
  # dropped. The match was already committed; the alert was permanently
  # orphaned from the Incident workflow with no automatic retry.
  #
  # Now the failure mode is: job raises → ActiveJob retry_on kicks in →
  # SolidQueue retries with backoff → eventually succeeds, or after the
  # retry budget exhausts the job is sent to the dead-letter table for
  # manual review. Either way, no silent loss.
  class FusionJob < ApplicationJob
    queue_as :background

    retry_on StandardError, wait: :polynomially_longer, attempts: 5

    # If the match has been deleted between enqueue and execution
    # (admin action, not a normal flow), discard rather than retry.
    discard_on ActiveJob::DeserializationError
    discard_on ActiveRecord::RecordNotFound

    def perform(match_id)
      match = SignalRuleMatch.find(match_id)
      Incidents::FusionService.call(match: match)
    end
  end
end
