class Asset < ApplicationRecord
  STATUSES = %w[available assigned degraded offline].freeze
  ASSET_TYPES = %w[vehicle equipment personnel].freeze

  belongs_to :home_site, class_name: "Site", foreign_key: :home_site_id, optional: true

  validates :name, presence: true
  validates :asset_type, presence: true
  validates :status, inclusion: { in: STATUSES }
end
