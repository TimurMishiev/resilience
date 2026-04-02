class CommanderIntentPolicy < ApplicationPolicy
  def create? = commander?
  def update? = commander?
end
