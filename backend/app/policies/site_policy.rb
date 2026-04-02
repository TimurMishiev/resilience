class SitePolicy < ApplicationPolicy
  # All authenticated users may view sites and their derived data.
  def index?        = true
  def show?         = site_accessible?(record)
  def risk_history? = show?
  def timeline?     = show?

  # Mutations are commander-only.
  def toggle_status?   = commander?
  def update_geofence? = commander?
  def unflag?          = commander?

  class Scope < ApplicationPolicy::Scope
    def resolve
      site_scope(scope)
    end
  end
end
