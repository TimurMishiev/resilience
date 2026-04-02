class PlanningPolicy < ApplicationPolicy
  # Planning surface is commander-only — enforced by require_commander! before_action.
  # This policy exists solely to satisfy Pundit's verify_authorized after_action.
  def index? = commander?
end
