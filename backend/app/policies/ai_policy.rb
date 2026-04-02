class AiPolicy < ApplicationPolicy
  def filter?         = commander?
  def ontology_query? = commander?
  def export?         = commander?
  def summary?        = commander?
end
