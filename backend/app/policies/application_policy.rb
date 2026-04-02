class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    raise Pundit::NotAuthorizedError, "must be logged in" unless user

    @user   = user
    @record = record
  end

  # ── Default rules ──────────────────────────────────────────────────────────
  # All authenticated users may read; mutations default to commander-only.
  # Individual policies override these as needed.

  def index?   = true
  def show?    = true
  def create?  = commander?
  def update?  = commander?
  def destroy? = commander?

  protected

  def commander?
    user.role == "commander"
  end

  def operator?
    user.role == "operator"
  end

  class Scope
    def initialize(user, scope)
      @user  = user
      @scope = scope
    end

    def resolve
      @scope.all
    end

    private

    attr_reader :user, :scope
  end
end
