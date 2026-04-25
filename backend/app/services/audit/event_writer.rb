module Audit
  # Writes a single immutable AuditEvent record.
  # Must be called inside an open database transaction.
  #
  # All service objects that mutate state should call this.
  # Never call from model callbacks.
  #
  # Chain-of-custody contract (ADR-010): every row is hash-chained to the
  # previous row in its organization's chain. The chain is serialised by a
  # per-org Postgres advisory transaction lock — concurrent writers in the
  # same org wait; concurrent writers in different orgs run in parallel.
  # The lock auto-releases when the surrounding transaction commits or
  # rolls back; the model fields are computed and persisted atomically
  # with the rest of the row.
  class EventWriter
    CHAIN_LOCK_DOMAIN = "audit_chain"

    # Deadlock retry budget for the audit chain write. Codex's
    # post-commit gate on Tranche 4A surfaced four
    # ActiveRecord::Deadlocked failures in the full backend suite
    # rooted at this method — the new MFA audit-event paths
    # (mfa.enabled / mfa.disabled / mfa.code_used) interact with
    # other concurrent audit writers under broader suite pressure.
    # The realistic deadlock vector: writer A holds the audit row
    # lock + waits for the per-org advisory lock; writer B holds
    # the advisory lock + waits for a row touched in A's
    # entity-resolution path. PG aborts one transaction on lock-
    # cycle detection, releasing the advisory lock; the retry
    # starts fresh, re-resolves the chain tip, and writes a new
    # chain_position cleanly. Three attempts with polynomial
    # backoff handles the realistic-load case without masking a
    # real chain-of-custody bug (which would deadlock every
    # attempt).
    MAX_DEADLOCK_RETRIES = 3
    DEADLOCK_BACKOFF_BASE_SECONDS = 0.05

    def self.write(
      actor:,
      entity_type:,
      entity_id:,
      event_type:,
      after_snapshot:,
      correlation_id:,
      action: nil,
      before_snapshot: nil,
      metadata: nil,
      organization_id: :resolve
    )
      resolved_org = if organization_id == :resolve
                       resolve_organization_id(entity_type, entity_id, before_snapshot: before_snapshot)
                     else
                       organization_id
                     end

      attempts = 0
      begin
        attempts += 1
        write_chained_event(
          actor:            actor,
          entity_type:      entity_type,
          entity_id:        entity_id,
          event_type:       event_type,
          after_snapshot:   after_snapshot,
          correlation_id:   correlation_id,
          action:           action,
          before_snapshot:  before_snapshot,
          metadata:         metadata,
          resolved_org:     resolved_org,
        )
      rescue ActiveRecord::Deadlocked => e
        raise if attempts >= MAX_DEADLOCK_RETRIES
        Rails.logger.warn(
          "[Audit::EventWriter] deadlock_retry attempt=#{attempts}/#{MAX_DEADLOCK_RETRIES} " \
          "event_type=#{event_type} entity_type=#{entity_type} entity_id=#{entity_id} " \
          "error=#{e.message.lines.first&.strip}"
        )
        sleep(DEADLOCK_BACKOFF_BASE_SECONDS * (2 ** (attempts - 1)))
        retry
      end
    end

    def self.write_chained_event(
      actor:, entity_type:, entity_id:, event_type:, after_snapshot:,
      correlation_id:, action:, before_snapshot:, metadata:, resolved_org:
    )
      AuditEvent.transaction(requires_new: false) do
        acquire_chain_lock!(resolved_org)

        tip            = chain_tip_for(resolved_org)
        chain_position = (tip[:position] || 0) + 1
        prev_hash      = tip[:row_hash] || ChainHasher.genesis_prev_hash(resolved_org)

        id          = SecureRandom.uuid
        sequence    = AuditEvent.connection.select_value(
          "SELECT nextval('audit_events_sequence_seq')"
        ).to_i
        occurred_at = Time.current

        attrs = {
          id:               id,
          schema_version:   1,
          actor:            actor,
          entity_type:      entity_type,
          entity_id:        entity_id,
          event_type:       event_type,
          action:           action,
          before_snapshot:  before_snapshot,
          after_snapshot:   after_snapshot,
          metadata:         metadata,
          correlation_id:   correlation_id,
          occurred_at:      occurred_at,
          organization_id:  resolved_org,
          sequence:         sequence,
          chain_position:   chain_position,
          prev_hash:        prev_hash,
          hash_version:     ChainHasher::HASH_VERSION,
        }
        row_hash = ChainHasher.compute(attrs)

        AuditEvent.create!(attrs.merge(row_hash: row_hash))
      end
    end

    def self.acquire_chain_lock!(organization_id)
      key = chain_lock_key(organization_id)
      AuditEvent.connection.execute(
        ActiveRecord::Base.send(
          :sanitize_sql_array,
          [ "SELECT pg_advisory_xact_lock(?)", key ]
        )
      )
    end

    # The lock key is a stable bigint derived from a per-org domain
    # string. hashtextextended() (Postgres 11+) returns a deterministic
    # bigint suitable for advisory-lock keys; the literal string is
    # written into the SQL with sanitize_sql_array so an exotic
    # organization_id cannot inject. Returns the hashed value as an int.
    def self.chain_lock_key(organization_id)
      scope = organization_id.present? ? "org:#{organization_id}" : "global"
      AuditEvent.connection.select_value(
        ActiveRecord::Base.send(
          :sanitize_sql_array,
          [ "SELECT hashtextextended(?, 0)", "#{CHAIN_LOCK_DOMAIN}:#{scope}" ]
        )
      ).to_i
    end

    def self.chain_tip_for(organization_id)
      scope = AuditEvent.where(organization_id: organization_id)
      row   = scope.order(chain_position: :desc).limit(1).pick(:chain_position, :row_hash)
      return { position: nil, row_hash: nil } if row.nil?

      position, row_hash = row
      { position: position, row_hash: row_hash }
    end

    def self.resolve_organization_id(entity_type, entity_id, before_snapshot: nil)
      from_db = case entity_type
                when "Site", "AreaOfOperation", "User"
                  entity_type.constantize.where(id: entity_id).pick(:organization_id)
                when "Task"
                  Task.joins(:site).where(id: entity_id).pick("sites.organization_id")
                when "Incident"
                  Incident.left_joins(:site, :area_of_operation)
                          .where(id: entity_id)
                          .pick(Arel.sql("COALESCE(sites.organization_id, areas_of_operation.organization_id)"))
                when "SignalRuleMatch"
                  SignalRuleMatch.left_joins(:site).where(id: entity_id).pick("sites.organization_id")
                when "Asset"
                  Asset.left_joins(:home_site).where(id: entity_id).pick("sites.organization_id")
                when "Recommendation"
                  rec = Recommendation.find_by(id: entity_id)
                  resolve_organization_id(rec.affected_entity_type, rec.affected_entity_id, before_snapshot: before_snapshot) if rec
                when "CorrelationRule", "Chokepoint", "CommanderIntent", "PacePlan", "SaluteReport"
                  klass = entity_type.constantize
                  klass.joins(:area_of_operation).where(id: entity_id).pick("areas_of_operation.organization_id")
                when "Organization"
                  entity_id
                end

      return from_db if from_db.present?

      # Destroy-after-delete fallback. When an auditable entity is destroyed
      # inside the same transaction that writes its audit event, the row is
      # no longer visible to the lookups above and from_db is nil. Without
      # this fallback the audit event would persist with a nil
      # organization_id and be visible globally through
      # events_controller.rb:88's "events without org_id pass through"
      # rule — the same class of leak fixed in prosecution_service.rb.
      # Callers are expected to pass a before_snapshot that carries the
      # organization_id (directly or via a nested site/AO shape); we
      # probe the common locations.
      snapshot_org_id(before_snapshot)
    end

    # Extracts organization_id from a destroyed entity's before_snapshot.
    # Handles three shapes: flat { "organization_id" => ... },
    # nested { "site" => { "organization_id" => ... } }, and
    # AO-anchored { "area_of_operation" => { "organization_id" => ... } }.
    def self.snapshot_org_id(before_snapshot)
      return nil unless before_snapshot.is_a?(Hash)

      h = before_snapshot.with_indifferent_access
      return h[:organization_id] if h[:organization_id].present?
      return h.dig(:site, :organization_id) if h.dig(:site, :organization_id).present?
      return h.dig(:area_of_operation, :organization_id) if h.dig(:area_of_operation, :organization_id).present?

      nil
    end
  end
end
