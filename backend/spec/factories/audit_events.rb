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
  end
end
