class EventPolicy < ApplicationPolicy
  # SSE event stream — all authenticated users may connect.
  # When multi-org is activated, scope filtering should be applied
  # at the broadcast level (filtering events per-connection based on
  # the user's org/AO scope), not by blocking stream access entirely.
  def stream? = true
end
