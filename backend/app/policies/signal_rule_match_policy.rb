class SignalRuleMatchPolicy < ApplicationPolicy
  # All authenticated users may view alerts.
  # Viewers may not triage (transition/bulk_transition are write operations).
  def index?               = true
  def show?                = signal_rule_match_accessible?(record)
  def transition?          = operator_or_above? && show?
  def allowed_transitions? = show?
  def bulk_transition?     = operator_or_above?
  def active_breach_sites? = true

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      scoped_by_site = scope.where(site_id: site_scope.select(:id))
      scoped_by_incident = scope.where(site_id: nil, incident_id: IncidentPolicy::Scope.new(user, Incident.all).resolve.select(:id))
      scoped_by_task = scope.where(
        site_id: nil,
        incident_id: nil,
        task_id: TaskPolicy::Scope.new(user, Task.all).resolve.select(:id)
      )

      scoped_by_site.or(scoped_by_incident).or(scoped_by_task)
    end
  end
end
