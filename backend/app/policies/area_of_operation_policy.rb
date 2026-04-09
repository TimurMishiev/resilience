class AreaOfOperationPolicy < ApplicationPolicy
  def index? = true
  def show?  = area_of_operation_surface_accessible?(record)

  def create?        = commander? && user.area_of_operation_id.blank?
  def update?        = commander? && owned_area_of_operation_accessible?(record)
  def destroy?       = commander? && owned_area_of_operation_accessible?(record)
  def update_posture? = commander? && owned_area_of_operation_accessible?(record)

  class Scope < ApplicationPolicy::Scope
    def resolve
      area_of_operation_surface_scope(scope)
    end
  end
end
