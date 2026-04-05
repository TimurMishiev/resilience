# Headless Pundit policy for session management.
# SessionsController uses manual `can_manage_sessions_for?` checks for
# fine-grained target-user authorization; this policy ensures every action
# passes through `verify_authorized` so new actions cannot ship unprotected.
class SessionPolicy < ApplicationPolicy
  # Login — unauthenticated endpoint; override initialize to allow nil user.
  def initialize(user, record)
    @user   = user
    @record = record
  end

  def create?  = true

  # All authenticated users may view, revoke, and manage their own sessions.
  # Admin targeting of other users is enforced in the controller.
  def index?      = true
  def destroy?    = true
  def revoke?     = true
  def revoke_all? = true

  class Scope < ApplicationPolicy::Scope
    def resolve
      scope.all
    end
  end
end
