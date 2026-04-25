class MfaPolicy < ApplicationPolicy
  # Any authenticated user may manage their own MFA setup. The
  # policy exists primarily to satisfy the `verify_authorized`
  # after-action and to leave a single chokepoint for a future
  # role-based escalation (e.g. admin-required to disable for
  # certain roles).
  def enroll?
    user.present?
  end

  def confirm?
    user.present?
  end

  def disable?
    user.present?
  end
end
