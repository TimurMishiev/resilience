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

  def scope_restricted?
    user.organization_id.present? || user.area_of_operation_id.present?
  end

  def site_accessible?(site)
    return true unless scope_restricted?
    return false if site.nil?
    return false if user.organization_id.present? && site.organization_id != user.organization_id
    return false if user.area_of_operation_id.present? && site.area_of_operation_id != user.area_of_operation_id

    true
  end

  def area_of_operation_accessible?(area_or_id)
    return true unless scope_restricted?

    area_id = area_or_id.respond_to?(:id) ? area_or_id.id : area_or_id
    return false if area_id.blank?
    return false if user.area_of_operation_id.present? && area_id != user.area_of_operation_id
    return true unless user.organization_id.present?

    AreaOfOperation.joins(:sites).where(id: area_id, sites: { organization_id: user.organization_id }).exists?
  end

  def incident_accessible?(incident)
    return site_accessible?(incident.site) if incident.site.present?

    area_of_operation_accessible?(incident.area_of_operation_id)
  end

  def signal_rule_match_accessible?(match)
    return site_accessible?(match.site) if match.site.present?
    return incident_accessible?(match.incident) if match.incident.present?
    return site_accessible?(match.task&.site) if match.task.present?

    !scope_restricted?
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

    def scope_restricted?
      user.organization_id.present? || user.area_of_operation_id.present?
    end

    def site_scope(base = Site.all)
      scoped = base
      scoped = scoped.where(organization_id: user.organization_id) if user.organization_id.present?
      scoped = scoped.where(area_of_operation_id: user.area_of_operation_id) if user.area_of_operation_id.present?
      scoped
    end

    def area_of_operation_scope(base = AreaOfOperation.all)
      scoped = base
      if user.organization_id.present?
        scoped = scoped.joins(:sites).where(sites: { organization_id: user.organization_id }).distinct
      end
      scoped = scoped.where(id: user.area_of_operation_id) if user.area_of_operation_id.present?
      scoped
    end

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
