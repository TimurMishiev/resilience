class TelemetryReadingPolicy < ApplicationPolicy
  # Pundit authorizes the action (may the viewer open a telemetry stream?).
  # Per-payload tenant filtering — organization + area_of_operation — lives in
  # Api::TelemetryController#stream and reuses AssetPolicy::Scope, the same
  # scope that powers the snapshot endpoint. Keeping payload-level scope out of
  # this policy mirrors Api::EventsController and preserves live/replay
  # consistency (both paths gate on the same AssetPolicy::Scope result).
  def index?  = true
  def trails? = true
  def stream? = true
end
