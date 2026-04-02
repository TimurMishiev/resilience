class RecommendationPolicy < ApplicationPolicy
  def index?   = true
  def show?    = recommendation_accessible?(record)
  def metrics? = true

  def generate? = commander? && !scope_restricted?
  def accept?   = commander? && show?
  def reject?   = commander? && show?
  def defer?    = commander? && show?
  def execute?  = commander? && show?

  class Scope < ApplicationPolicy::Scope
    def resolve
      return scope unless scope_restricted?

      relations = [
        scope.where(affected_entity_type: "Asset", affected_entity_id: AssetPolicy::Scope.new(user, Asset.all).resolve.select(:id)),
        scope.where(affected_entity_type: "Incident", affected_entity_id: IncidentPolicy::Scope.new(user, Incident.all).resolve.select(:id)),
        scope.where(affected_entity_type: "SignalRuleMatch", affected_entity_id: SignalRuleMatchPolicy::Scope.new(user, SignalRuleMatch.all).resolve.select(:id)),
        scope.where(affected_entity_type: "Site", affected_entity_id: SitePolicy::Scope.new(user, Site.all).resolve.select(:id)),
        scope.where(affected_entity_type: "Task", affected_entity_id: TaskPolicy::Scope.new(user, Task.all).resolve.select(:id)),
      ]

      relations.reduce { |combined, relation| combined.or(relation) }
    end
  end

  private

  def recommendation_accessible?(recommendation)
    return true unless scope_restricted?

    relation = case recommendation.affected_entity_type
               when "Asset"
                 AssetPolicy::Scope.new(user, Asset.all).resolve
               when "Incident"
                 IncidentPolicy::Scope.new(user, Incident.all).resolve
               when "SignalRuleMatch"
                 SignalRuleMatchPolicy::Scope.new(user, SignalRuleMatch.all).resolve
               when "Site"
                 SitePolicy::Scope.new(user, Site.all).resolve
               when "Task"
                 TaskPolicy::Scope.new(user, Task.all).resolve
               else
                 return false
               end

    relation.where(id: recommendation.affected_entity_id).exists?
  end
end
