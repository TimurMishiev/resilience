# Runtime budget enforcement (ADR-011).
#
# In production, this initializer fails the boot if either the
# primary pool (web path) or the queue pool (SolidQueue) is sized
# below the contract documented in ADR-011 + RuntimeBudget::Validator.
#
# Why fail boot rather than warn:
#   A pool that's too small does not fail under light load. The
#   primary pool degrades to ActiveRecord::ConnectionTimeoutError on
#   the API path under SSE+request bursts; the queue pool starves
#   SolidQueue dispatch under job load. Health checks pass, the LB
#   keeps routing, operators see "the app is slow" — exactly the
#   silent-degradation pattern the broader hardening initiative is
#   closing. Crashing on boot surfaces the problem to a deploy log
#   entry, not a mid-shift incident.
#
# Skipped outside production. Override emergency-only via
# RUNTIME_BUDGET_SKIP=1.
Rails.application.config.after_initialize do
  next unless RuntimeBudget::Validator.should_validate?

  # The queue pool is only meaningful when SolidQueue is configured
  # to use it. SolidQueue::Record (added by `config.solid_queue.connects_to`
  # in production.rb) is the canonical entry point — its connection_pool
  # is the queue pool. We resolve it lazily and tolerate absence so a
  # production env that has not yet activated SQ (or that runs SQ in a
  # separate process via SOLID_QUEUE_IN_PUMA=false) doesn't false-fail
  # the boot.
  queue_pool = if defined?(SolidQueue::Record)
                 SolidQueue::Record.connection_pool
               end

  begin
    RuntimeBudget::Validator.validate!(queue_pool: queue_pool)
  rescue RuntimeBudget::Validator::InsufficientPoolError => e
    Rails.logger.error("[RuntimeBudget] #{e.message}")
    raise
  end
end
