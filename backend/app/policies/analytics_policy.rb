class AnalyticsPolicy < ApplicationPolicy
  def throughput? = true
  def swimlane?   = true
end
