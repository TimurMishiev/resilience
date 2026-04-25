class AuditChainPolicy < ApplicationPolicy
  # Admin-only access to the chain-of-custody integrity surface
  # (ADR-010). The verifier walks every organization's chain so it
  # returns cross-tenant integrity state — must be gated to admins.
  def verify?
    admin?
  end
end
