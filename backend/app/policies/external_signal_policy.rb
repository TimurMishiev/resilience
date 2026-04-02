class ExternalSignalPolicy < ApplicationPolicy
  def index?  = true
  def show?   = true
  def stream? = true
  def create? = commander?
end
