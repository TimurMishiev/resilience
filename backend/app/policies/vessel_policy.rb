# Vessels are global maritime entities tracked via AIS — they have no
# organization ownership. All authenticated users see all vessels; tenant
# isolation is enforced at the signal match / incident level where vessel
# activity is correlated to org-scoped sites.
class VesselPolicy < ApplicationPolicy
  def index?  = true
  def show?   = true
  def tracks? = true
end
