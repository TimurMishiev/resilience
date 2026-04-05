# frozen_string_literal: true

# Shared org/AO scoping for audit events.
# Audit events don't carry organization_id directly, so we scope them by
# checking that the referenced entity is visible within the user's org/AO.
module AuditEventScoping
  extend ActiveSupport::Concern

  private

  # Returns an ActiveRecord relation of audit events restricted to entities
  # visible to the current user's organization / area-of-operation scope.
  # Users with no org/AO restriction see all events.
  def scope_audit_events_by_org(events)
    return events unless current_user.organization_id.present? || current_user.area_of_operation_id.present?

    visible_site_ids = policy_scope(Site).select(:id)
    visible_ao_ids   = policy_scope(AreaOfOperation).select(:id)

    t = AuditEvent.arel_table
    conditions = [
      t[:entity_type].eq("Site").and(t[:entity_id].in(visible_site_ids.arel)),
      t[:entity_type].eq("AreaOfOperation").and(t[:entity_id].in(visible_ao_ids.arel)),
      t[:entity_type].eq("Task").and(t[:entity_id].in(Task.where(site_id: visible_site_ids).select(:id).arel)),
      t[:entity_type].eq("Incident").and(t[:entity_id].in(
        Incident.where(site_id: visible_site_ids)
                .or(Incident.where(area_of_operation_id: visible_ao_ids))
                .select(:id).arel
      )),
      t[:entity_type].eq("SignalRuleMatch").and(t[:entity_id].in(SignalRuleMatch.where(site_id: visible_site_ids).select(:id).arel)),
      t[:entity_type].eq("CorrelationRule").and(t[:entity_id].in(CorrelationRule.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
      t[:entity_type].eq("Asset").and(t[:entity_id].in(policy_scope(Asset).select(:id).arel)),
      t[:entity_type].eq("Chokepoint").and(t[:entity_id].in(Chokepoint.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
      t[:entity_type].eq("PacePlan").and(t[:entity_id].in(PacePlan.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
      t[:entity_type].eq("CommanderIntent").and(t[:entity_id].in(CommanderIntent.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
      t[:entity_type].eq("SaluteReport").and(t[:entity_id].in(SaluteReport.where(area_of_operation_id: visible_ao_ids).select(:id).arel)),
      t[:entity_type].eq("Recommendation").and(t[:entity_id].in(policy_scope(Recommendation).select(:id).arel)),
      *(current_user.organization_id.present? ? [
        t[:entity_type].eq("User").and(t[:entity_id].in(User.where(organization_id: current_user.organization_id).select(:id).arel)),
        t[:entity_type].eq("Organization").and(t[:entity_id].eq(current_user.organization_id)),
      ] : []),
    ]

    events.where(conditions.reduce { |a, b| a.or(b) })
  end
end
