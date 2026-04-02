class User < ApplicationRecord
  has_secure_password

  # Role hierarchy (ascending privilege):
  #   viewer    — read-only access; may be scoped to a single AO via area_of_operation_id
  #   operator  — full read + limited write (acknowledge alerts, update own tasks)
  #   commander — full read + write; can create rules, assign assets, manage sites
  ROLES = %w[viewer operator commander].freeze

  belongs_to :organization,       optional: true
  belongs_to :area_of_operation, optional: true

  validates :email, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: ROLES }

  before_save { self.email = email.downcase }

  # Role predicates — use these in policies, never compare role strings directly.
  def viewer?
    role == "viewer"
  end

  def operator?
    role == "operator"
  end

  def commander?
    role == "commander"
  end

  # Returns true for any role that can perform write operations.
  def operator_or_above?
    operator? || commander?
  end
end
