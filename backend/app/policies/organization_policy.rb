class OrganizationPolicy < ApplicationPolicy
  def index?  = admin?
  def show?   = admin? || own_organization?
  def create? = admin?
  def update? = admin?
  def destroy? = admin?

  class Scope < ApplicationPolicy::Scope
    def resolve
      if user.admin?
        scope.all
      elsif user.organization_id.present?
        scope.where(id: user.organization_id)
      else
        scope.none
      end
    end
  end

  private

  def own_organization?
    user.organization_id.present? && record.id == user.organization_id
  end
end
