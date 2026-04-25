class AddChainColumnsToAuditEvents < ActiveRecord::Migration[8.1]
  # Adds the chain-of-custody columns described in ADR-010. New columns are
  # nullable here (except hash_version which carries a constant default
  # safe under PG11+ — no table rewrite). Backfill + NOT NULL enforcement
  # land in follow-up migrations once Audit::ChainHasher is wired into
  # Audit::EventWriter and existing rows have been hashed in place.
  #
  # WHY each column:
  #
  # - chain_position: per-organization monotonic 1..N within a chain. The
  #   tip of the chain is `MAX(chain_position) WHERE organization_id = ?`.
  #   Indexed jointly with organization_id (in a follow-up migration that
  #   uses CREATE INDEX CONCURRENTLY) to make tip lookups O(log N).
  #
  # - prev_hash: 32-byte SHA-256 of the previous row in the chain. The
  #   first row in each org chain (chain_position = 1) carries the
  #   deterministic genesis sentinel
  #   (sha256("audit_chain_genesis:org:<id>") or
  #   sha256("audit_chain_genesis:global") for nil-org events).
  #
  # - row_hash: 32-byte SHA-256 over a canonical encoding of every other
  #   column (id, actor, entity, snapshots, metadata, correlation_id,
  #   occurred_at, sequence, organization_id, chain_position, prev_hash,
  #   hash_version). Tampering with any field — or attempting to reorder,
  #   re-key, or drop a row — invalidates this hash and every downstream
  #   row's prev_hash → row_hash linkage.
  #
  # - hash_version: lets us evolve the canonicalisation/hash recipe
  #   without breaking historical rows. v1 is the recipe described in
  #   Audit::ChainHasher.
  def change
    add_column :audit_events, :chain_position, :bigint
    add_column :audit_events, :prev_hash,      :binary
    add_column :audit_events, :row_hash,       :binary
    add_column :audit_events, :hash_version,   :smallint, default: 1, null: false
  end
end
