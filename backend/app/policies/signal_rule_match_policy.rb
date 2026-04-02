class SignalRuleMatchPolicy < ApplicationPolicy
  # All authenticated users may view alerts.
  # Viewers may not triage (transition/bulk_transition are write operations).
  def index?               = true
  def show?                = true
  def transition?          = operator_or_above?
  def allowed_transitions? = true
  def bulk_transition?     = operator_or_above?
  def active_breach_sites? = true
end
