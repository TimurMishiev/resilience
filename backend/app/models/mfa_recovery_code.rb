class MfaRecoveryCode < ApplicationRecord
  # Single-use BCrypt-hashed backup code. Stored hash-only — the
  # plaintext is shown to the user exactly once on enrollment and
  # never again (Tranche 3B, ADR-009 item 4).
  belongs_to :user

  validates :code_hash, presence: true

  scope :active, -> { where(used_at: nil) }
  scope :used,   -> { where.not(used_at: nil) }

  # Verifies a plaintext recovery code against this row's hash via
  # BCrypt::Password constant-time compare. Caller is expected to
  # iterate active codes and call matches? on each — there's no
  # lookup-by-plaintext path because the salt is per-row, so we
  # can't do a single SQL WHERE.
  def matches?(plaintext)
    return false if used_at.present? || code_hash.blank? || plaintext.blank?
    BCrypt::Password.new(code_hash) == plaintext.to_s.strip.downcase
  rescue BCrypt::Errors::InvalidHash
    false
  end

  # Note: there is deliberately NO instance-level mark_used! helper.
  # Redemption goes through the conditional UPDATE-WHERE pattern in
  # Mfa::VerificationService (`update_all(used_at: ...)` with
  # `WHERE id = ? AND used_at IS NULL`) so the single-use guarantee
  # holds under concurrent requests. A naive `update!(used_at: ...)`
  # would race; rather than ship a non-atomic helper that the
  # verifier no longer uses, we leave the redemption path to live
  # in one place.
end
