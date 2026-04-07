class ExportPolicy < ApplicationPolicy
  # All authenticated users can export data they can already read.
  # Row-level scoping is enforced by policy_scope in the controller.
  def create? = true
end
