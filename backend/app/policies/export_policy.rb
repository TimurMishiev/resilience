class ExportPolicy < ApplicationPolicy
  def create? = commander?
end
