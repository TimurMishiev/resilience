class BackfillAuditEventChain < ActiveRecord::Migration[8.1]
  # Walks every existing audit_events row that does not yet have a
  # row_hash and assigns chain_position, prev_hash, row_hash, and
  # hash_version per the ADR-010 chain-of-custody contract.
  #
  # Idempotent. Re-running this migration is a no-op if every row is
  # already chained — useful if a partial deploy leaves some rows
  # un-chained. The work itself is delegated to Audit::ChainBackfiller
  # so operators can also invoke it from a console without re-running
  # migrations.
  #
  # MUST run BEFORE 20260424220004_prevent_audit_event_mutations: once
  # the immutability triggers are live, no UPDATE on audit_events is
  # permitted from any session, and a backfill UPDATE would raise.
  def up
    require Rails.root.join("app/services/audit/chain_hasher")
    require Rails.root.join("app/services/audit/chain_backfiller")

    report = Audit::ChainBackfiller.run!
    say "Backfilled audit_events chain: #{report.inspect}"
  end

  def down
    # Reverting the backfill clears the chain fields but leaves the
    # columns in place — the up direction of the next migration
    # (NOT NULL enforcement) is what would actually fail to reverse.
    execute <<~SQL
      UPDATE audit_events
      SET chain_position = NULL,
          prev_hash      = NULL,
          row_hash       = NULL
    SQL
  end
end
