class PacePlanPolicy < ApplicationPolicy
  def show? = owned_area_of_operation_accessible?(record.area_of_operation_id)
  def create? = commander? && owned_area_of_operation_accessible?(record.area_of_operation_id)
  def update? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(area_of_operation_id: owned_area_of_operation_scope.select(:id))
    end
  end
end
