class User < ApplicationRecord
  has_secure_password

  # Role hierarchy (ascending privilege):
  #   viewer    — read-only access; may be scoped to a single AO via area_of_operation_id
  #   operator  — full read + limited write (acknowledge alerts, update own tasks)
  #   commander — operational command authority for one tenant/workspace scope
  #   admin     — highest privilege; may manage sessions and broader platform controls
  ROLES = %w[viewer operator commander admin].freeze

  belongs_to :organization,       optional: true
  belongs_to :area_of_operation, optional: true
  has_many :user_sessions, dependent: :destroy
  has_many :revoked_user_sessions, class_name: "UserSession", foreign_key: :revoked_by_id, dependent: :nullify

  # Inverse has_many for all creator/actor/assignee FK references.
  # Users must never be hard-deleted (Organization enforces :restrict_with_exception),
  # so :restrict_with_exception here is a structural guard, not a runtime concern.
  has_many :created_areas_of_operation, class_name: "AreaOfOperation", foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :created_commander_intents,  class_name: "CommanderIntent",  foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :updated_commander_intents,  class_name: "CommanderIntent",  foreign_key: :updated_by_id, dependent: :restrict_with_exception, inverse_of: :updated_by
  has_many :created_pace_plans,         class_name: "PacePlan",         foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :updated_pace_plans,         class_name: "PacePlan",         foreign_key: :updated_by_id, dependent: :restrict_with_exception, inverse_of: :updated_by
  has_many :created_chokepoints,        class_name: "Chokepoint",       foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :updated_chokepoints,        class_name: "Chokepoint",       foreign_key: :updated_by_id, dependent: :restrict_with_exception, inverse_of: :updated_by
  has_many :created_salute_reports,     class_name: "SaluteReport",     foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :created_correlation_rules,  class_name: "CorrelationRule",  foreign_key: :created_by_id, dependent: :restrict_with_exception, inverse_of: :created_by
  has_many :authored_incident_notes,    class_name: "IncidentNote",     foreign_key: :author_id,     dependent: :restrict_with_exception, inverse_of: :author
  has_many :prosecution_steps,          class_name: "ProsecutionStep",  foreign_key: :actor_id,      dependent: :restrict_with_exception, inverse_of: :actor
  has_many :acknowledged_matches,       class_name: "SignalRuleMatch",  foreign_key: :acknowledged_by_id, dependent: :nullify, inverse_of: :acknowledged_by
  has_many :assigned_incidents,         class_name: "Incident",         foreign_key: :assigned_to_id,     dependent: :nullify, inverse_of: :assigned_to
  has_many :prosecuted_incidents,       class_name: "Incident",         foreign_key: :prosecuted_by_id,   dependent: :nullify, inverse_of: :prosecuted_by
  has_many :sse_stream_leases,          class_name: "SseStreamLease",   dependent: :destroy
  has_many :reviewed_recommendations,   class_name: "Recommendation",   foreign_key: :reviewed_by_id,     dependent: :nullify, inverse_of: :reviewer
  has_many :mfa_recovery_codes,         dependent: :delete_all

  validates :email, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: ROLES }
  validate :area_of_operation_belongs_to_organization

  before_save { self.email = email.downcase }

  # TOTP accessor pair (Tranche 3B / ADR-009 item 4). The plaintext
  # base32 secret is encrypted on write via Mfa::SecretCipher and
  # decrypted on read; the underlying column (totp_secret_ciphertext)
  # is bytea. mfa_recovery_codes are deleted with the user — the
  # backup-code rotation is part of the same root of trust that
  # rotates with the secret.
  def totp_secret
    @totp_secret_plaintext_cache ||= Mfa::SecretCipher.decrypt(totp_secret_ciphertext)
  end

  def totp_secret=(plaintext)
    @totp_secret_plaintext_cache = nil
    self.totp_secret_ciphertext  = Mfa::SecretCipher.encrypt(plaintext)
  end

  def totp_enabled?
    totp_enabled_at.present?
  end

  # Role predicates — use these in policies, never compare role strings directly.
  def viewer?
    role == "viewer"
  end

  def operator?
    role == "operator"
  end

  def commander?
    role == "commander" || admin?
  end

  def admin?
    role == "admin"
  end

  # Returns true for any role that can perform write operations.
  def operator_or_above?
    operator? || commander?
  end

  def can_manage_sessions_for?(target_user)
    return false if target_user.nil?
    return true if admin?

    id == target_user.id
  end

  private

  def area_of_operation_belongs_to_organization
    return if area_of_operation.blank? || organization.blank?
    return unless area_of_operation.respond_to?(:organization_id)
    return if area_of_operation.organization_id.blank?
    return if area_of_operation.organization_id == organization_id

    errors.add(:area_of_operation_id, "must belong to the same organization")
  end
end
