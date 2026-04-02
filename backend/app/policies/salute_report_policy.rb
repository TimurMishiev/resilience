class SaluteReportPolicy < ApplicationPolicy
  def show? = area_of_operation_accessible?(record.area_of_operation_id)
  def create? = commander? && area_of_operation_accessible?(record.area_of_operation_id)

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scope.where(area_of_operation_id: area_of_operation_scope.select(:id))
    end
  end
end
