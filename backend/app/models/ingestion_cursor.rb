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
  def self.for(name, initial_lookback: 1.minute)
    find_or_create_by!(name: name) do |cursor|
      cursor.last_ingested_at = initial_lookback.ago
      cursor.last_signal_id = nil
    end
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

  # Advances the cursor to the given signal (the last one in the batch).
  # Idempotent: advancing to an already-passed point is a no-op.
  def advance_to(signal)
    return if signal.nil?
    return if last_ingested_at > signal.ingested_at
    return if last_ingested_at == signal.ingested_at && last_signal_id.to_s >= signal.id.to_s

    update!(last_ingested_at: signal.ingested_at, last_signal_id: signal.id)
  end
end
