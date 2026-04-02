class SignalRuleMatchPolicy < ApplicationPolicy
  # All authenticated users may view and triage alerts.
  def index?               = true
  def show?                = true
  def transition?          = true
  def allowed_transitions? = true
  def bulk_transition?     = true
  def active_breach_sites? = true
end
