require "digest"

module Audit
  # Walks every existing audit_events row that does not yet have a row_hash
  # and assigns chain fields (chain_position, prev_hash, row_hash,
  # hash_version) per the ADR-010 chain-of-custody contract.
  #
  # Used in two places:
  #
  #   1. The 20260424220002 migration calls .run! during the deploy that
  #      ships the chain-of-custody work.
  #   2. Operators can re-run it ad-hoc if the chain ever diverges
  #      catastrophically and a re-baseline is required (combined with
  #      Audit::ChainVerifier to confirm correctness post-fix).
  #
  # Idempotent: rows that already have a row_hash are skipped. Within a
  # given organization chain (or the global nil-org chain), rows are
  # ordered by (occurred_at, sequence) — the same temporal order
  # Replay::ProjectionService uses, so the backfilled chain is
  # consistent with the replay contract.
  #
  # The backfill must run BEFORE the 20260424220004 trigger migration
  # installs the immutability triggers — once those triggers are live,
  # no UPDATE on audit_events is permitted from any session. Migration
  # ordering enforces this.
  module ChainBackfiller
    module_function

    # Returns a small report:
    #   { chains_processed: N, rows_hashed: M, rows_skipped: K }
    #
    # No public knobs by design. The backfill always covers "every row
    # missing a row_hash" — that's the production contract and what the
    # 20260424220002 migration calls. A previous version of this method
    # exposed a string `where:` kwarg for narrowing; it was unused in
    # both production and specs, and Brakeman correctly flagged the
    # `WHERE #{where}` interpolation as a SQL-injection surface even
    # though every caller passed the default. Removed in favour of the
    # AR query below. If a future caller genuinely needs to narrow the
    # backfill, add a kwarg that takes a relation or a structured
    # filter (Hash/Arel) — never a SQL fragment.
    def run!
      chains_processed = 0
      rows_hashed      = 0
      rows_skipped     = 0

      # Discover every chain that has at least one un-hashed row.
      # `unscoped` is defensive in case AuditEvent ever grows a
      # default_scope; the backfill must see every row.
      org_ids = AuditEvent
        .unscoped
        .where(row_hash: nil)
        .distinct
        .order(:organization_id)
        .pluck(:organization_id)

      org_ids.each do |organization_id|
        chains_processed += 1

        # Within a chain, two rows can share the same prev_hash slot only
        # if both already have a row_hash — i.e. they were chained on a
        # previous run. We pull the chain in canonical replay order,
        # then walk it carrying prev_hash forward.
        rows = AuditEvent.where(organization_id: organization_id)
                         .order(:occurred_at, :sequence)
                         .select(:id, :schema_version, :actor, :entity_type, :entity_id,
                                 :event_type, :action, :before_snapshot, :after_snapshot,
                                 :metadata, :correlation_id, :occurred_at, :sequence,
                                 :organization_id, :chain_position, :prev_hash, :row_hash,
                                 :hash_version)
                         .to_a

        prev_row_hash  = ChainHasher.genesis_prev_hash(organization_id)
        next_position  = 1

        rows.each do |row|
          if row.row_hash.present?
            # Already chained on a prior run — carry its row_hash forward
            # so any subsequent un-chained rows link onto the existing
            # chain instead of starting a parallel one.
            prev_row_hash = row.row_hash
            next_position = row.chain_position.to_i + 1
            rows_skipped += 1
            next
          end

          attrs = {
            id:               row.id,
            schema_version:   row.schema_version,
            actor:            row.actor,
            entity_type:      row.entity_type,
            entity_id:        row.entity_id,
            event_type:       row.event_type,
            action:           row.action,
            before_snapshot:  row.before_snapshot,
            after_snapshot:   row.after_snapshot,
            metadata:         row.metadata,
            correlation_id:   row.correlation_id,
            occurred_at:      row.occurred_at,
            sequence:         row.sequence,
            organization_id:  row.organization_id,
            chain_position:   next_position,
            prev_hash:        prev_row_hash,
            hash_version:     ChainHasher::HASH_VERSION,
          }
          row_hash = ChainHasher.compute(attrs)

          # update_all goes through AR's type system, which encodes
          # bytea correctly. Raw sanitize_sql_array would coerce the
          # 32-byte binary string through UTF-8 quoting and fail.
          AuditEvent.unscoped.where(id: row.id).update_all(
            chain_position: next_position,
            prev_hash:      prev_row_hash,
            row_hash:       row_hash,
            hash_version:   ChainHasher::HASH_VERSION,
          )

          prev_row_hash  = row_hash
          next_position += 1
          rows_hashed   += 1
        end
      end

      { chains_processed: chains_processed, rows_hashed: rows_hashed, rows_skipped: rows_skipped }
    end
  end
end
