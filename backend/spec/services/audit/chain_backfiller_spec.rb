require "rails_helper"

# Audit::ChainBackfiller is the migration-time helper that walks
# pre-Tranche-A audit_events rows and assigns chain fields (ADR-010).
# We verify it on rows that DO NOT have chain fields by inserting them
# via raw SQL — bypassing the immutability trigger, which only fires
# on UPDATE / DELETE, and bypassing Audit::EventWriter so we can
# simulate the "old rows" state.
RSpec.describe Audit::ChainBackfiller do
  let(:org)   { create(:organization) }
  let(:org2)  { create(:organization) }

  before do
    # In production the backfill migration (20260424220002) runs BEFORE
    # the NOT NULL migration (20260424220003) and BEFORE the
    # immutability trigger migration (20260424220004), so it sees
    # nullable chain columns and an UPDATE-able audit_events table.
    # By the time this spec runs, ALL migrations have been applied, so
    # we relax both constraints inside the test transaction. RSpec's
    # transactional fixtures roll back the DDL when the test ends so
    # other specs continue to see the production-correct schema.
    conn = ActiveRecord::Base.connection
    conn.execute("ALTER TABLE audit_events ALTER COLUMN chain_position DROP NOT NULL")
    conn.execute("ALTER TABLE audit_events ALTER COLUMN prev_hash DROP NOT NULL")
    conn.execute("ALTER TABLE audit_events ALTER COLUMN row_hash DROP NOT NULL")
    conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_update")
    conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_delete")
  end

  def insert_unchained_event(organization_id:, occurred_at:, sequence_value:)
    id = SecureRandom.uuid
    AuditEvent.connection.exec_insert(
      ActiveRecord::Base.send(
        :sanitize_sql_array,
        [
          <<~SQL.squish,
            INSERT INTO audit_events
              (id, schema_version, actor, entity_type, entity_id,
               event_type, action, before_snapshot, after_snapshot,
               metadata, correlation_id, occurred_at, organization_id,
               sequence, hash_version)
            VALUES (?, 1, 'system', 'Task', ?, 'task.created', 'create',
                    NULL, ?::jsonb, ?::jsonb, ?, ?, ?, ?, 1)
          SQL
          id,
          SecureRandom.uuid,
          { "id" => SecureRandom.uuid, "workflow_status" => "new" }.to_json,
          {}.to_json,
          SecureRandom.uuid,
          occurred_at,
          organization_id,
          sequence_value,
        ]
      )
    )
    id
  end

  it "is a no-op on a database with no un-chained rows" do
    report = described_class.run!
    expect(report[:rows_hashed]).to eq(0)
    expect(report[:chains_processed]).to eq(0)
  end

  it "chains rows in (occurred_at, sequence) order within an org" do
    base = 3.hours.ago.change(usec: 0)
    id1 = insert_unchained_event(organization_id: org.id, occurred_at: base,             sequence_value: 1001)
    id2 = insert_unchained_event(organization_id: org.id, occurred_at: base + 1.hour,    sequence_value: 1002)
    id3 = insert_unchained_event(organization_id: org.id, occurred_at: base + 2.hours,   sequence_value: 1003)

    report = described_class.run!
    expect(report[:chains_processed]).to eq(1)
    expect(report[:rows_hashed]).to eq(3)

    e1 = AuditEvent.find(id1)
    e2 = AuditEvent.find(id2)
    e3 = AuditEvent.find(id3)

    expect(e1.chain_position).to eq(1)
    expect(e2.chain_position).to eq(2)
    expect(e3.chain_position).to eq(3)

    expect(e1.prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(org.id))
    expect(e2.prev_hash).to eq(e1.row_hash)
    expect(e3.prev_hash).to eq(e2.row_hash)

    [ e1, e2, e3 ].each { |e| expect(e.row_hash.bytesize).to eq(32) }
  end

  it "produces independent chains per organization" do
    base = 2.hours.ago.change(usec: 0)
    a1 = insert_unchained_event(organization_id: org.id,  occurred_at: base,           sequence_value: 2001)
    b1 = insert_unchained_event(organization_id: org2.id, occurred_at: base + 5.minutes,   sequence_value: 2002)
    a2 = insert_unchained_event(organization_id: org.id,  occurred_at: base + 10.minutes,  sequence_value: 2003)

    report = described_class.run!
    expect(report[:chains_processed]).to eq(2)
    expect(report[:rows_hashed]).to eq(3)

    expect(AuditEvent.find(a1).chain_position).to eq(1)
    expect(AuditEvent.find(b1).chain_position).to eq(1)
    expect(AuditEvent.find(a2).chain_position).to eq(2)

    expect(AuditEvent.find(a1).prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(org.id))
    expect(AuditEvent.find(b1).prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(org2.id))
    expect(AuditEvent.find(a2).prev_hash).to eq(AuditEvent.find(a1).row_hash)
  end

  it "handles the global (nil-org) chain with the global genesis sentinel" do
    base = 1.hour.ago.change(usec: 0)
    id1 = insert_unchained_event(organization_id: nil, occurred_at: base,           sequence_value: 3001)
    id2 = insert_unchained_event(organization_id: nil, occurred_at: base + 30.minutes,  sequence_value: 3002)

    described_class.run!

    e1 = AuditEvent.find(id1)
    e2 = AuditEvent.find(id2)

    expect(e1.organization_id).to be_nil
    expect(e1.chain_position).to eq(1)
    expect(e1.prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(nil))
    expect(e2.prev_hash).to eq(e1.row_hash)
  end

  it "is idempotent — re-running skips already-chained rows and continues from the tip" do
    base = 90.minutes.ago.change(usec: 0)
    id1 = insert_unchained_event(organization_id: org.id, occurred_at: base,         sequence_value: 4001)
    id2 = insert_unchained_event(organization_id: org.id, occurred_at: base + 1.minute, sequence_value: 4002)

    first_report = described_class.run!
    expect(first_report[:rows_hashed]).to eq(2)

    e1_after_first = AuditEvent.find(id1)
    e2_after_first = AuditEvent.find(id2)
    original_e1_hash = e1_after_first.row_hash
    original_e2_hash = e2_after_first.row_hash

    # Insert one more un-chained row beyond the existing chain
    id3 = insert_unchained_event(organization_id: org.id, occurred_at: base + 2.minutes, sequence_value: 4003)

    second_report = described_class.run!
    expect(second_report[:rows_hashed]).to eq(1)
    expect(second_report[:rows_skipped]).to eq(2)

    # Existing rows must not have been re-hashed
    expect(AuditEvent.find(id1).row_hash).to eq(original_e1_hash)
    expect(AuditEvent.find(id2).row_hash).to eq(original_e2_hash)

    e3 = AuditEvent.find(id3)
    expect(e3.chain_position).to eq(3)
    expect(e3.prev_hash).to eq(original_e2_hash)
  end

  it "produces a chain whose row_hash recomputes from canonical inputs" do
    base = 30.minutes.ago.change(usec: 0)
    id  = insert_unchained_event(organization_id: org.id, occurred_at: base, sequence_value: 5001)

    described_class.run!
    e = AuditEvent.find(id)

    recomputed = Audit::ChainHasher.compute(
      hash_version:    e.hash_version,
      organization_id: e.organization_id,
      chain_position:  e.chain_position,
      prev_hash:       e.prev_hash,
      id:              e.id,
      schema_version:  e.schema_version,
      actor:           e.actor,
      entity_type:     e.entity_type,
      entity_id:       e.entity_id,
      event_type:      e.event_type,
      action:          e.action,
      correlation_id:  e.correlation_id,
      occurred_at:     e.occurred_at,
      sequence:        e.sequence,
      before_snapshot: e.before_snapshot,
      after_snapshot:  e.after_snapshot,
      metadata:        e.metadata,
    )

    expect(recomputed).to eq(e.row_hash)
  end
end
