class RevokedJwt < ApplicationRecord
  validates :jti, presence: true, uniqueness: true
  validates :expires_at, presence: true

  scope :active, -> { where("expires_at > ?", Time.current) }
end
