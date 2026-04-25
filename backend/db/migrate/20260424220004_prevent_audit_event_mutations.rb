class PreventAuditEventMutations < ActiveRecord::Migration[8.1]
  # Closes ADR-009 item 1: enforces audit_events immutability at the
  # database layer. Until now the model carried a Ruby-level readonly!
  # flag (after_initialize :freeze_if_persisted), which a raw SQL
  # session or a console mistake would bypass. These triggers fire
  # BEFORE any UPDATE or DELETE and raise a Postgres-level exception,
  # so even a compromised DB role with table privileges cannot rewrite
  # or remove a row without first dropping the trigger — and dropping
  # a trigger leaves a forensic mark in the Postgres logs.
  #
  # Combined with the chain-of-custody hash from ADR-010, this means:
  #   - Tampering attempt 1 (UPDATE a row): blocked by the trigger.
  #   - Tampering attempt 2 (DELETE a row): blocked by the trigger.
  #   - Tampering attempt 3 (drop the triggers, then UPDATE): the
  #     UPDATE succeeds, but the row's row_hash no longer matches the
  #     ChainHasher recomputation, AND every downstream row's prev_hash
  #     no longer matches its predecessor's row_hash. Audit::ChainVerifier
  #     reports the exact chain_position that broke.
  #
  # WHY no truncation guard: TRUNCATE uses a separate trigger event
  # (BEFORE TRUNCATE) and we deliberately allow it because RSpec's
  # transactional fixture cleanup relies on TRUNCATE for some specs.
  # Production-grade defence-tech deployment would add the truncation
  # guard plus a Postgres role that lacks TRUNCATE privilege; that's
  # noted in ADR-010 as an out-of-scope hardening step.
  # WHY safety_assured around the execute blocks: strong_migrations
  # cannot statically prove that creating a trigger is safe and asks us
  # to opt in. The trigger creation runs in a single statement and
  # takes a brief lock on audit_events; the existing
  # 20260321225132_prevent_incident_note_updates migration follows the
  # same shape (execute CREATE TRIGGER without safety_assured because
  # strong_migrations' check is recent). For audit_events we opt in
  # explicitly so the intent is documented in code.
  def up
    safety_assured do
      execute <<~SQL
        CREATE OR REPLACE FUNCTION prevent_audit_event_update()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_events are immutable — updates are not permitted (see ADR-009 item 1, ADR-010)';
        END;
        $$;

        CREATE TRIGGER audit_events_immutable_update
          BEFORE UPDATE ON audit_events
          FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_update();

        CREATE OR REPLACE FUNCTION prevent_audit_event_delete()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_events are append-only — deletes are not permitted (see ADR-009 item 1, ADR-010)';
        END;
        $$;

        CREATE TRIGGER audit_events_immutable_delete
          BEFORE DELETE ON audit_events
          FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_delete();
      SQL
    end
  end

  def down
    safety_assured do
      execute <<~SQL
        DROP TRIGGER IF EXISTS audit_events_immutable_update ON audit_events;
        DROP TRIGGER IF EXISTS audit_events_immutable_delete ON audit_events;
        DROP FUNCTION IF EXISTS prevent_audit_event_update();
        DROP FUNCTION IF EXISTS prevent_audit_event_delete();
      SQL
    end
  end
end
