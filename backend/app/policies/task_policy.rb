class TaskPolicy < ApplicationPolicy
  # All authenticated users (operators and commanders) may read and work tasks.
  # Tasks are the primary operational unit — operators are expected to create,
  # update, and transition them as part of their workflow.
  # Viewers may read but not write.
  def index?              = true
  def show?               = site_accessible?(record.site)
  def create?             = operator_or_above? && site_accessible?(record.site)
  def update?             = operator_or_above? && show?
  def transition?         = operator_or_above? && show?
  def allowed_transitions? = show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(site_id: site_scope.select(:id))
    end
  end
end
