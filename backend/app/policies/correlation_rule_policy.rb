class CorrelationRulePolicy < ApplicationPolicy
  # All authenticated users may view rules and effectiveness stats.
  def index?        = true
  def show?         = true
  def effectiveness? = true

  # Rule authoring, dry-run, and deletion are commander-only.
  def create?  = commander?
  def update?  = commander?
  def destroy? = commander?
  def dry_run? = commander?
end
