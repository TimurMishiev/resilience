FactoryBot.define do
  factory :audit_event do
    schema_version  { 1 }
    actor           { "system" }
    entity_type     { "Task" }
    entity_id       { SecureRandom.uuid }
    event_type      { "task.created" }
    action          { "create" }
    before_snapshot { nil }
    after_snapshot  { { "id" => SecureRandom.uuid, "workflow_status" => "new" } }
    metadata        { {} }
    correlation_id  { SecureRandom.uuid }
    occurred_at     { Time.current }

    # NOT NULL chain-of-custody fields (ADR-010). Factory rows are NOT
    # part of a real chain — Audit::ChainVerifier deliberately walks
    # rows produced by Audit::EventWriter, which is the only path that
    # builds a real chain. These random values exist to satisfy the
    # schema's NOT NULL + uniqueness constraints in tests that don't
    # exercise chain semantics. Tests that DO exercise the chain must
    # use Audit::EventWriter.write.
    chain_position { rand(1_000_000_000_000..9_000_000_000_000) }
    prev_hash      { SecureRandom.bytes(32) }
    row_hash       { SecureRandom.bytes(32) }
    hash_version   { 1 }
  end
end
