module Audit
  # Walks an audit_events chain end-to-end and verifies the
  # chain-of-custody contract from ADR-010:
  #
  #   1. Every chain_position is present and monotonic (1, 2, 3, ...
  #      with no gaps).
  #   2. The first row's prev_hash equals the deterministic genesis
  #      sentinel for that chain (sha256("audit_chain_genesis:org:<id>")
  #      or sha256("audit_chain_genesis:global") for nil-org).
  #   3. Each subsequent row's prev_hash equals the previous row's
  #      row_hash.
  #   4. Each row's stored row_hash equals ChainHasher.compute over
  #      the row's actual fields — i.e. nothing was tampered with.
  #
  # On the first violation, the verifier returns a Verification with
  # valid=false and the chain_position + reason where the chain broke.
  # Subsequent violations cascade and are not reported individually —
  # operators fix the first break and re-verify.
  #
  # Used by:
  #
  #   - Audit::VerifyAllChainsJob (recurring) — daily integrity sweep.
  #   - Api::Admin::AuditChainController#index — on-demand verification.
  #   - Operator console for ad-hoc spot checks during incident response.
  module ChainVerifier
    Verification = Struct.new(
      :organization_id,
      :rows_checked,
      :valid,
      :broken_at,
      :reason,
      :expected,
      :actual,
      keyword_init: true
    ) do
      def to_h_serialisable
        {
          organization_id: organization_id,
          rows_checked:    rows_checked,
          valid:           valid,
          broken_at:       broken_at,
          reason:          reason,
          expected:        expected&.then { |v| v.is_a?(String) ? v.unpack1("H*") : v },
          actual:          actual&.then   { |v| v.is_a?(String) ? v.unpack1("H*") : v },
        }
      end
    end

    module_function

    # Returns a Verification for the given organization (or nil for
    # the global chain). Walks rows ordered by chain_position. Reads
    # are repeatable-read level via a single transaction.
    def verify_organization(organization_id)
      AuditEvent.transaction(requires_new: false) do
        rows = AuditEvent.where(organization_id: organization_id)
                         .order(chain_position: :asc)
                         .to_a

        if rows.empty?
          return Verification.new(
            organization_id: organization_id,
            rows_checked:    0,
            valid:           true,
            broken_at:       nil,
            reason:          nil,
          )
        end

        prev_row_hash = ChainHasher.genesis_prev_hash(organization_id)

        rows.each_with_index do |row, idx|
          expected_position = idx + 1
          if row.chain_position != expected_position
            return Verification.new(
              organization_id: organization_id,
              rows_checked:    idx + 1,
              valid:           false,
              broken_at:       row.chain_position,
              reason:          "chain_position gap or reorder (expected #{expected_position}, got #{row.chain_position})",
              expected:        expected_position,
              actual:          row.chain_position,
            )
          end

          if row.prev_hash != prev_row_hash
            return Verification.new(
              organization_id: organization_id,
              rows_checked:    idx + 1,
              valid:           false,
              broken_at:       row.chain_position,
              reason:          (idx.zero? ? "first row prev_hash does not match genesis sentinel" : "prev_hash does not match previous row's row_hash"),
              expected:        prev_row_hash,
              actual:          row.prev_hash,
            )
          end

          recomputed = ChainHasher.compute(
            hash_version:    row.hash_version,
            organization_id: row.organization_id,
            chain_position:  row.chain_position,
            prev_hash:       row.prev_hash,
            id:              row.id,
            schema_version:  row.schema_version,
            actor:           row.actor,
            entity_type:     row.entity_type,
            entity_id:       row.entity_id,
            event_type:      row.event_type,
            action:          row.action,
            correlation_id:  row.correlation_id,
            occurred_at:     row.occurred_at,
            sequence:        row.sequence,
            before_snapshot: row.before_snapshot,
            after_snapshot:  row.after_snapshot,
            metadata:        row.metadata,
          )

          if recomputed != row.row_hash
            return Verification.new(
              organization_id: organization_id,
              rows_checked:    idx + 1,
              valid:           false,
              broken_at:       row.chain_position,
              reason:          "row_hash recomputation does not match stored value (row content tampered)",
              expected:        recomputed,
              actual:          row.row_hash,
            )
          end

          prev_row_hash = row.row_hash
        end

        Verification.new(
          organization_id: organization_id,
          rows_checked:    rows.length,
          valid:           true,
          broken_at:       nil,
          reason:          nil,
        )
      end
    end

    # Iterates every chain (one per organization_id, plus the global
    # nil-org chain if any) and returns one Verification per chain.
    # Operators decide what to do with breaks; this method does not
    # raise — it reports.
    def verify_all
      org_ids = AuditEvent.distinct.pluck(:organization_id)
      org_ids.map { |org_id| verify_organization(org_id) }
    end
  end
end
