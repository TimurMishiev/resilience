class AddTotpToUsers < ActiveRecord::Migration[8.1]
  # MFA TOTP (Tranche 3B, ADR-009 item 4 partial-CLOSED).
  #
  # totp_secret_ciphertext stores the base32-encoded TOTP secret
  # encrypted with ActiveSupport::MessageEncryptor (key derived from
  # Rails.application.secret_key_base — the same root of trust JWT
  # signing already uses). Stored as bytea so the encrypted bytes
  # round-trip cleanly without text-encoding concerns.
  #
  # totp_enabled_at marks the moment the user confirmed their first
  # valid code during enrollment. Until set, the secret is allocated
  # but MFA is NOT enforced at login — this is the "draft" state
  # between issuing the provisioning URI and the user actually
  # demonstrating that their authenticator app is set up correctly.
  #
  # totp_last_used_at is the replay-protection guard. RFC 6238
  # codes are valid for one ~30 s step; a captured code re-played
  # within the same step would otherwise authenticate the attacker.
  # We reject any verify attempt where the new step would equal a
  # step already used.
  def change
    add_column :users, :totp_secret_ciphertext, :binary
    add_column :users, :totp_enabled_at,        :datetime
    add_column :users, :totp_last_used_at,      :datetime
  end
end
