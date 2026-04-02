class SitePolicy < ApplicationPolicy
  # All authenticated users may view sites and their derived data.
  def index?        = true
  def show?         = true
  def risk_history? = true
  def timeline?     = true

  # Mutations are commander-only.
  def toggle_status?   = commander?
  def update_geofence? = commander?
  def unflag?          = commander?

  class Scope < ApplicationPolicy::Scope
    def resolve
      # Apply org isolation first, then AO narrowing within that org.
      org_filter(ao_filter(scope))
    end
  end
end
