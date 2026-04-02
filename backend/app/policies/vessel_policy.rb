class VesselPolicy < ApplicationPolicy
  def index?  = true
  def show?   = true
  def tracks? = true
end
