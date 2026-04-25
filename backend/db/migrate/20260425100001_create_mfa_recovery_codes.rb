class CreateMfaRecoveryCodes < ActiveRecord::Migration[8.1]
  # Single-use BCrypt-hashed backup codes for users who lose their
  # TOTP authenticator (Tranche 3B, ADR-009 item 4).
  #
  # Each row stores ONE bcrypt hash of one plaintext recovery code.
  # The plaintext is shown to the user exactly once during MFA
  # enrollment + after manual regeneration — same contract as
  # GitHub / Google Authenticator backup codes.
  #
  # used_at is nil for unused codes and timestamped on first
  # successful redemption. The forensic record of "this user
  # redeemed a recovery code at this time" lives in audit_events
  # (the chain-hashed `mfa.code_used` event from
  # Mfa::VerificationService), not in this side table — rotation
  # of MFA wipes these rows because the durable trail is
  # elsewhere.
  def change
    create_table :mfa_recovery_codes, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.text       :code_hash,  null: false
      t.datetime   :used_at,    null: true
      t.datetime   :created_at, null: false
    end

    # Tip-of-chain query: how many active recovery codes does this
    # user have left? Indexed partial because used codes never
    # need to be queried in batches.
    add_index :mfa_recovery_codes, [ :user_id, :used_at ], where: "used_at IS NULL",
              name: :idx_mfa_recovery_codes_active_per_user
  end
end
