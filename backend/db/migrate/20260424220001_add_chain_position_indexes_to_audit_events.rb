class AddChainPositionIndexesToAuditEvents < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  # Two partial unique indexes enforce "exactly one row per chain
  # position" within each chain.
  #
  # WHY split scoped vs unscoped:
  #   A composite unique index on (organization_id, chain_position)
  #   treats NULLs as distinct, so multiple NULL-org rows could collide
  #   on chain_position. Splitting into one partial unique for
  #   organization_id IS NOT NULL and a second partial unique for
  #   organization_id IS NULL gives us "one row per chain_position" in
  #   each chain (per-org chains plus the global nil-org chain).
  #
  # WHY concurrently:
  #   strong_migrations correctly forbids non-concurrent index creation
  #   on a non-empty table. CONCURRENTLY adds the index without blocking
  #   writes. The follow-up backfill migration will populate
  #   chain_position before NOT NULL is enforced; up to that point the
  #   index simply has no rows to constrain.
  def change
    add_index :audit_events, [ :organization_id, :chain_position ],
              unique:    true,
              where:     "organization_id IS NOT NULL",
              name:      :idx_audit_events_chain_position_scoped,
              algorithm: :concurrently

    add_index :audit_events, :chain_position,
              unique:    true,
              where:     "organization_id IS NULL",
              name:      :idx_audit_events_chain_position_unscoped,
              algorithm: :concurrently
  end
end
