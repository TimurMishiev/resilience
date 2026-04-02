class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    raise Pundit::NotAuthorizedError, "must be logged in" unless user

    @user   = user
    @record = record
  end

  # ── Default rules ────────────────────────────────────────────────────────────
  # All authenticated users may read; mutations default to commander-only.
  # Individual policies override these as needed.

  def index?   = true
  def show?    = true
  def create?  = commander?
  def update?  = commander?
  def destroy? = commander?

  protected

  def viewer?
    user.role == "viewer"
  end

  def operator?
    user.role == "operator"
  end

  def commander?
    user.role == "commander"
  end

  def operator_or_above?
    operator? || commander?
  end

  # ── AO-scoped scope helpers ──────────────────────────────────────────────────
  # Call ao_filter(scope, column:) in Scope#resolve to restrict records to the
  # user's area_of_operation_id when the user has a site scope set.

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

    # Filters scope to records whose `column` matches the user's AO when the
    # user has area_of_operation_id set. Pass through unmodified otherwise.
    def ao_filter(base, column: :area_of_operation_id)
      return base unless user.area_of_operation_id.present?

      base.where(column => user.area_of_operation_id)
    end

    # Filters scope via a site join — for models that belong_to :site.
    # Joins to sites and limits to those in the user's AO.
    def ao_filter_via_site(base)
      return base unless user.area_of_operation_id.present?

      base.joins(:site).where(sites: { area_of_operation_id: user.area_of_operation_id })
    end

    # Filters scope to the user's organization when organization_id is set.
    # Models that do not have organization_id are returned unfiltered.
    def org_filter(base, column: :organization_id)
      return base unless user.organization_id.present?

      base.where(column => user.organization_id)
    end

    # Filters via sites table for models that belong_to :site.
    def org_filter_via_site(base)
      return base unless user.organization_id.present?

      base.joins(:site).where(sites: { organization_id: user.organization_id })
    end
  end
end
