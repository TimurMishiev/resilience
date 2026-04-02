class AssetPolicy < ApplicationPolicy
  def index? = true
  def show?  = true
  def update? = commander?
end
