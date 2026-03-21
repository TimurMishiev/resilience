class Site < ApplicationRecord
  STATUSES = %w[active inactive].freeze

  belongs_to :area_of_operation, optional: true

  has_many :tasks, dependent: :restrict_with_error
  has_many :assets, foreign_key: :home_site_id, dependent: :nullify, inverse_of: :home_site

  validates :name, presence: true
  validates :latitude, presence: true, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }
  validates :longitude, presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :status, inclusion: { in: STATUSES }
  validates :geofence_radius_km, numericality: { greater_than: 0, less_than_or_equal_to: 2000 }

  scope :active,  -> { where(status: "active") }
  scope :flagged, -> { where.not(flagged_at: nil) }
end
