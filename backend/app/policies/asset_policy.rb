class AssetPolicy < ApplicationPolicy
  def index? = true
  def show?  = true
  def update? = commander?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless user.area_of_operation_id.present?

      # Assets are homed to a site; scope to assets whose home site is in the user's AO.
      scoped_site_ids = Site.where(area_of_operation_id: user.area_of_operation_id).select(:id)
      scope.where(home_site_id: scoped_site_ids)
    end
  end
end
