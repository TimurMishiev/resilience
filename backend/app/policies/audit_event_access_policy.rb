class AuditEventAccessPolicy < ApplicationPolicy
  # Entity-scoped audit history is available to any authenticated user so
  # operator-facing detail pages can render inline history. Global audit access
  # remains commander-only because it exposes cross-entity actor + snapshot data.
  def index?
    return commander? if record.entity_type.blank? || record.entity_id.blank?

    true
  end
end
