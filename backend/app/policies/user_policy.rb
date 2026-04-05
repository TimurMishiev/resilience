# frozen_string_literal: true

class UserPolicy < ApplicationPolicy
  def index?   = admin?
  def show?    = admin? || record.id == user.id
  def update?  = admin?

  class Scope < ApplicationPolicy::Scope
    def resolve
      if user.admin?
        scope.all
      else
        scope.where(id: user.id)
      end
    end
  end
end
