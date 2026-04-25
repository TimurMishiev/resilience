# Singleton-per-name high-water mark for signal-consumer jobs. Protects
# against queue-latency drops: a tick reads signals strictly after the
# cursor, never relative to wall-clock time, so a delayed worker picks
# up exactly where the last successful tick left off.
#
# The cursor is (last_ingested_at, last_signal_id). Ties on ingested_at
# microseconds resolve by signal id, guaranteeing no signal is processed
# twice or skipped even under concurrent ingestion bursts.
class IngestionCursor < ApplicationRecord
  validates :name, presence: true, uniqueness: true
  validates :last_ingested_at, presence: true

  # Fetches the cursor for a given consumer, initializing it on first
  # call so a fresh deploy does not replay every historical signal. The
  # initial cursor is set to `initial_lookback.ago` so the first tick
  # picks up signals ingested during the deploy window without
  # swallowing the backlog from before the feature existed.
  #
  # Race-safe across multiple workers booting simultaneously: the unique
  # index on `name` means at most one INSERT wins; losers rescue the
  # ActiveRecord::RecordNotUnique and read the winner's row instead of
  # propagating noise into retry_on.
  def self.for(name, initial_lookback: 1.minute)
    find_or_create_by!(name: name) do |cursor|
      cursor.last_ingested_at = initial_lookback.ago
      cursor.last_signal_id = nil
    end
  rescue ActiveRecord::RecordNotUnique
    find_by!(name: name)
  end

  # Returns the ActiveRecord scope of signals strictly after this cursor.
  # Ordered by (ingested_at, id) ascending so advance_to at the end of
  # the batch picks up exactly the last processed signal.
  #
  # The composite "greater-than" is expressed as the standard tuple
  # inequality:
  #   (ingested_at, id) > (last_ingested_at, last_signal_id)
  # which in SQL is:
  #   ingested_at > x OR (ingested_at = x AND id > y)
  def signals_since(relation = ExternalSignal.all)
    if last_signal_id.present?
      relation.where(
        "(ingested_at > :ts) OR (ingested_at = :ts AND id > :sid)",
        ts: last_ingested_at, sid: last_signal_id
      ).order(:ingested_at, :id)
    else
      relation.where("ingested_at > ?", last_ingested_at).order(:ingested_at, :id)
    end
  end

  # Advances the cursor to the given signal via an atomic compare-and-set
  # so concurrent workers cannot regress the high-water mark.
  #
  # Why atomic: two ticks racing on the same cursor would each load the
  # current state, decide the new value is greater, and both UPDATE.
  # Without a guarded UPDATE the LATER write wins regardless of whose
  # value is actually higher — if worker B's signal is earlier than
  # worker A's, B's write would *regress* the cursor and cause A's
  # already-processed signals to be re-fetched on the next tick.
  # Downstream idempotency on SignalRuleMatch saves us from double-fires
  # but cannot save us from a regressed high-water mark; this guard
  # makes the regression impossible.
  #
  # Mirrors the row-lock claim pattern in Correlations::RuleFiringService:
  # an UPDATE ... WHERE that succeeds only when the precondition holds.
  # UUID `<` is the standard PostgreSQL lexicographic comparison
  # (gen_random_uuid produces hex strings whose lexicographic order is a
  # stable, total ordering — exactly what we need for tie-breaking).
  def advance_to(signal)
    return if signal.nil?

    rows_updated = self.class
      .where(id: id)
      .where(
        "last_ingested_at < :ts OR " \
        "(last_ingested_at = :ts AND (last_signal_id IS NULL OR last_signal_id < :sid))",
        ts: signal.ingested_at, sid: signal.id
      )
      .update_all(last_ingested_at: signal.ingested_at, last_signal_id: signal.id)

    reload if rows_updated.positive?
  end
end
