class RecommendationPolicy < ApplicationPolicy
  def index?   = true
  def metrics? = true

  def generate? = commander?
  def accept?   = commander?
  def reject?   = commander?
  def defer?    = commander?
  def execute?  = commander?
end
