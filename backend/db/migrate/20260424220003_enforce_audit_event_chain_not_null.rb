class EnforceAuditEventChainNotNull < ActiveRecord::Migration[8.1]
  # After Audit::ChainBackfiller has populated every existing row, we
  # enforce NOT NULL at the column level so a future row that somehow
  # bypasses Audit::EventWriter (raw SQL, console mistake) cannot land
  # without chain coverage. The check is fast on a fully-backfilled
  # table — Postgres validates the existing rows once and the
  # constraint is enforced on every subsequent INSERT.
  #
  # WHY safety_assured: change_column_null on an existing column issues
  # an ACCESS EXCLUSIVE lock long enough to scan the table for NULLs.
  # On audit_events at this scale (~100k rows) that lock is sub-second.
  # The strong_migrations production-safe pattern (add CHECK NOT VALID,
  # validate concurrently, swap to NOT NULL) is documented in ADR-010
  # for the multi-million-row case but deliberately not used here.
  def change
    safety_assured do
      change_column_null :audit_events, :chain_position, false
      change_column_null :audit_events, :prev_hash,      false
      change_column_null :audit_events, :row_hash,       false
    end
  end
end
