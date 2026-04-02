class AreaOfOperationPolicy < ApplicationPolicy
  def index? = true
  def show?  = true

  def create?        = commander?
  def update?        = commander?
  def destroy?       = commander?
  def update_posture? = commander?
end
