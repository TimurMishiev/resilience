class PacePlanPolicy < ApplicationPolicy
  def create? = commander?
  def update? = commander?
end
