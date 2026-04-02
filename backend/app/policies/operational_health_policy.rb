class OperationalHealthPolicy < ApplicationPolicy
  def index? = commander?
end
