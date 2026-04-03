class AreaOfOperationPolicy < ApplicationPolicy
  def index? = true
  def show?  = area_of_operation_accessible?(record)

  def create?        = commander? && user.area_of_operation_id.blank?
  def update?        = commander? && show?
  def destroy?       = commander? && show?
  def update_posture? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      area_of_operation_scope(scope)
    end
  end
end
