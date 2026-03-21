class SiteRiskSnapshot < ApplicationRecord
  RETENTION_DAYS = 90
  VALID_LEVELS   = %w[low moderate high critical].freeze

  belongs_to :site

  validates :score,          presence: true,
                             numericality: { only_integer: true, in: 0..100 }
  validates :risk_level,     presence: true, inclusion: { in: VALID_LEVELS }
  validates :alert_pressure, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :task_health,    presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :signal_density, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :recorded_at,    presence: true

  scope :for_site,   ->(id)   { where(site_id: id) }
  scope :within_days, ->(n)   { where("recorded_at > ?", n.days.ago) }
  scope :chronological,       -> { order(:recorded_at) }

  # Remove snapshots older than RETENTION_DAYS.
  # Called by Risk::SnapshotJob after each run so the table never grows unbounded.
  def self.prune_old!
    where("recorded_at < ?", RETENTION_DAYS.days.ago).delete_all
  end
end
