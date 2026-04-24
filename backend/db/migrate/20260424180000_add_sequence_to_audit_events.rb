class AddSequenceToAuditEvents < ActiveRecord::Migration[8.1]
  # Adds a monotonic, insertion-ordered sequence column so
  # Replay::ProjectionService can break ties on occurred_at deterministically.
  #
  # WHY this exists: audit_events.id is gen_random_uuid() — random, not
  # temporal. When two mutations on the same entity share an occurred_at
  # microsecond (concurrent write path under real load), the projection's
  # ORDER BY occurred_at DESC, id DESC would pick an arbitrary UUID winner.
  # A bigserial gives true "last insert wins" semantics.
  #
  # WHY safety_assured: adding a bigserial does a table rewrite under a
  # lock. strong_migrations (correctly) flags this as dangerous on
  # production-scale tables. For this deployment audit_events is
  # ~75-100k rows at most, well inside the "sub-second lock" regime
  # where a direct add is safe. For a multi-million-row deployment the
  # production-safe pattern is:
  #
  #   1. disable_ddl_transaction!
  #   2. execute "CREATE SEQUENCE audit_events_sequence_seq OWNED BY audit_events.sequence"
  #   3. add_column :audit_events, :sequence, :bigint,
  #                 default: -> { "nextval('audit_events_sequence_seq')" }
  #      (Postgres 11+: no rewrite for a constant-or-expression default on
  #      a new column; existing rows get the default lazily as they're read)
  #   4. Backfill in batches: UPDATE audit_events SET sequence = DEFAULT WHERE id IN (...)
  #   5. Add NOT NULL in a follow-up migration once backfill is verified.
  #
  # That 5-step pattern is deliberately NOT used here — the direct form is
  # honest about scale and avoids the complexity tax on a small table.
  def change
    safety_assured do
      add_column :audit_events, :sequence, :bigserial, null: false
    end

    # Intentionally no dedicated index on the sequence column. The existing
    # idx_on_entity_type_entity_id_occurred_at_dfd7f189aa narrows the
    # projection query to a tiny row set — tie-breaking on `sequence DESC`
    # runs in-memory over those few candidates, so a 4th-column index
    # would trade write amplification for negligible read speedup.
  end
end
