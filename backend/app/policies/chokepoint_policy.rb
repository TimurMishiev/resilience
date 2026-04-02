class ChokepointPolicy < ApplicationPolicy
  def index?   = true
  def show?    = area_of_operation_accessible?(record.area_of_operation_id)
  def create?  = commander? && area_of_operation_accessible?(record.area_of_operation_id)
  def update?  = commander? && show?
  def destroy? = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(area_of_operation_id: area_of_operation_scope.select(:id))
    end
  end
end
