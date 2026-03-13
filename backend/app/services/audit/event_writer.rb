module Audit
  # Writes a single immutable AuditEvent record.
  # Must be called inside an open database transaction.
  #
  # All service objects that mutate state should call this.
  # Never call from model callbacks.
  class EventWriter
    def self.write(
      actor:,
      entity_type:,
      entity_id:,
      event_type:,
      after_snapshot:,
      correlation_id:,
      action: nil,
      before_snapshot: nil,
      metadata: nil
    )
      AuditEvent.create!(
        schema_version: 1,
        actor: actor,
        entity_type: entity_type,
        entity_id: entity_id,
        event_type: event_type,
        action: action,
        before_snapshot: before_snapshot,
        after_snapshot: after_snapshot,
        metadata: metadata,
        correlation_id: correlation_id,
        occurred_at: Time.current
      )
    end
  end
end
