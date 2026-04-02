class FeedHealthPolicy < ApplicationPolicy
  def index? = commander?
end
