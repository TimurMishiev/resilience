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
      metadata: nil,
      organization_id: :resolve
    )
      resolved_org = if organization_id == :resolve
                       resolve_organization_id(entity_type, entity_id, before_snapshot: before_snapshot)
                     else
                       organization_id
                     end

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
        occurred_at: Time.current,
        organization_id: resolved_org
      )
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
