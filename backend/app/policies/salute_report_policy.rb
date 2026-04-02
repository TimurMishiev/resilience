class SaluteReportPolicy < ApplicationPolicy
  def create? = commander?
end
