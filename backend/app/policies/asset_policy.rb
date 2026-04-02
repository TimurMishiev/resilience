class AssetPolicy < ApplicationPolicy
  def index? = true
  def show?  = site_accessible?(record.home_site)
  def update? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(home_site_id: site_scope.select(:id))
    end
  end
end
