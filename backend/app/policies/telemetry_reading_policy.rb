class TelemetryReadingPolicy < ApplicationPolicy
  def index?  = true
  def trails? = true
  def stream? = true
end
