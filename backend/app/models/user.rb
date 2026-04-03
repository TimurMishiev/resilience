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

  validates :email, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: ROLES }
  validate :area_of_operation_belongs_to_organization

  before_save { self.email = email.downcase }

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
