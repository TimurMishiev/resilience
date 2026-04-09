class AreaOfOperationPolicy < ApplicationPolicy
  def index? = true
  def show?  = area_of_operation_accessible?(record, include_global: true)

  def create?        = commander? && user.area_of_operation_id.blank?
  def update?        = commander? && area_of_operation_accessible?(record)
  def destroy?       = commander? && area_of_operation_accessible?(record)
  def update_posture? = commander? && area_of_operation_accessible?(record)

  class Scope < ApplicationPolicy::Scope
    def resolve
      area_of_operation_scope(scope, include_global: true)
    end
  end
end
