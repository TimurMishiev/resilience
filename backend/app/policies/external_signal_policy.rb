# External signals (USGS seismic, AIS, OpenSky, FIRMS, etc.) are environmental
# data ingested from public/external feeds — they have no organization ownership.
# All authenticated users see all signals; tenant isolation is enforced at the
# SignalRuleMatch level where signals are matched to org-scoped sites.
class ExternalSignalPolicy < ApplicationPolicy
  def index?  = true
  def show?   = true
  def stream? = true
  def create? = commander?
end
