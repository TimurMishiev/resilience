class IncidentPolicy < ApplicationPolicy
  # All authenticated users may read incidents and perform routine operational
  # actions (transition, note, assign). Prosecution and high-impact steps
  # are commander-only.
  def index?               = true
  def show?                = incident_accessible?(record)
  def update?              = operator_or_above? && show?
  def transition?          = operator_or_above? && show?
  def allowed_transitions? = show?
  def chain?               = show?
  def list_notes?          = show?
  def add_note?            = operator_or_above? && show?
  def list_prosecution_steps? = show?

  # Operators may self-assign — the controller enforces the exact assignment
  # rules (self-assign/own-release) independently of this policy.
  def assign? = operator_or_above? && show?

  # Kill-chain prosecution is commander-only: high-impact irreversible action.
  def initiate_prosecution? = commander? && show?
  def add_prosecution_step? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scoped_by_site = scope.where(site_id: site_scope.select(:id))
      scoped_by_area = scope.where(site_id: nil, area_of_operation_id: owned_area_of_operation_scope.select(:id))

      scoped_by_site.or(scoped_by_area)
    end
  end
end
