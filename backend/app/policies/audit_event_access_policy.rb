class AuditEventAccessPolicy < ApplicationPolicy
  # Entity-scoped audit history is available to any authenticated user so
  # operator-facing detail pages can render inline history. Global audit access
  # remains commander-only because it exposes cross-entity actor + snapshot data.
  def index?
    commander? || record.entity_id.present?
  end
end
