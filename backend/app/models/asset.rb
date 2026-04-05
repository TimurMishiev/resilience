class Asset < ApplicationRecord
  STATUSES = %w[available assigned degraded offline].freeze
  ASSET_TYPES = %w[vehicle equipment personnel].freeze

  belongs_to :home_site, class_name: "Site", foreign_key: :home_site_id, optional: true
  has_many :tasks, dependent: :nullify
  # telemetry_readings uses ON DELETE CASCADE at DB level (partitioned table);
  # no dependent: option here — Rails destroy would load all rows into memory (OOM risk).
  has_many :telemetry_readings

  validates :name, presence: true
  validates :asset_type, presence: true, inclusion: { in: ASSET_TYPES }
  validates :status, inclusion: { in: STATUSES }
end
