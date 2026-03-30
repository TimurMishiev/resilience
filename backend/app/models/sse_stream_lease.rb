class SseStreamLease < ApplicationRecord
  STREAM_NAMES = %w[events telemetry signals].freeze

  belongs_to :user

  validates :stream_name, inclusion: { in: STREAM_NAMES }
  validates :remote_ip, :lease_key, :expires_at, presence: true
  validates :lease_key, uniqueness: true

  scope :active_at, ->(time) { where("expires_at > ?", time) }
  scope :expired_at, ->(time) { where("expires_at <= ?", time) }
end
