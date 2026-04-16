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
      resolved_org = organization_id == :resolve ? resolve_organization_id(entity_type, entity_id) : organization_id

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

    def self.resolve_organization_id(entity_type, entity_id)
      case entity_type
      when "Site", "AreaOfOperation", "User"
        entity_type.constantize.where(id: entity_id).pick(:organization_id)
      when "Task"
        Task.joins(:site).where(id: entity_id).pick("sites.organization_id")
      when "Incident"
        Incident.left_joins(:site, :area_of_operation)
                .where(id: entity_id)
                .pick(Arel.sql("COALESCE(sites.organization_id, areas_of_operation.organization_id)"))
      when "SignalRuleMatch"
        SignalRuleMatch.joins(:site).where(id: entity_id).pick("sites.organization_id")
      when "Asset"
        Asset.joins(:home_site).where(id: entity_id).pick("sites.organization_id")
      when "Recommendation"
        rec = Recommendation.find_by(id: entity_id)
        resolve_organization_id(rec.affected_entity_type, rec.affected_entity_id) if rec
      when "CorrelationRule", "Chokepoint", "CommanderIntent", "PacePlan", "SaluteReport"
        klass = entity_type.constantize
        klass.joins(:area_of_operation).where(id: entity_id).pick("areas_of_operation.organization_id")
      when "Organization"
        entity_id
      end
    end
  end
end
