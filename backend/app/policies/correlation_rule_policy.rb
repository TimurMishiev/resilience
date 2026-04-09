class CorrelationRulePolicy < ApplicationPolicy
  # All authenticated users may view rules and effectiveness stats.
  def index?        = true
  def show?         = owned_area_of_operation_accessible?(record.area_of_operation_id)
  def effectiveness? = true

  # Rule authoring, dry-run, and deletion are commander-only.
  def create?  = commander? && owned_area_of_operation_accessible?(record.area_of_operation_id)
  def update?  = commander? && show?
  def destroy? = commander? && show?
  def dry_run? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(area_of_operation_id: owned_area_of_operation_scope.select(:id))
    end
  end
end
