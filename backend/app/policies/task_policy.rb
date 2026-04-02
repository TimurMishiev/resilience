class TaskPolicy < ApplicationPolicy
  # All authenticated users (operators and commanders) may read and work tasks.
  # Tasks are the primary operational unit — operators are expected to create,
  # update, and transition them as part of their workflow.
  # Viewers may read but not write.
  def index?              = true
  def show?               = true
  def create?             = operator_or_above?
  def update?             = operator_or_above?
  def transition?         = operator_or_above?
  def allowed_transitions? = true

  class Scope < ApplicationPolicy::Scope
    def resolve
      ao_filter_via_site(scope)
    end
  end
end
