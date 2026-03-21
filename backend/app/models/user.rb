class User < ApplicationRecord
  has_secure_password

  ROLES = %w[operator commander].freeze

  validates :email, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: ROLES }

  before_save { self.email = email.downcase }

  def commander?
    role == "commander"
  end
end
