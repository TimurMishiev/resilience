class Chokepoint < ApplicationRecord
  CATEGORIES = %w[
    strait
    canal
    harbor_approach
    lane_constriction
    anchorage
  ].freeze
  STATUSES = %w[monitor constrained contested closed].freeze
  NAME_MAX_LENGTH = 120
  NOTES_MAX_LENGTH = 4_000

  belongs_to :area_of_operation
  belongs_to :created_by, class_name: "User"
  belongs_to :updated_by, class_name: "User"

  validates :name, presence: true, length: { maximum: NAME_MAX_LENGTH }, uniqueness: {
    scope: :area_of_operation_id,
    case_sensitive: false,
  }
  validates :category, inclusion: { in: CATEGORIES }
  validates :status, inclusion: { in: STATUSES }
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :watch_radius_km, numericality: { greater_than: 0, less_than_or_equal_to: 500 }
  validates :notes, length: { maximum: NOTES_MAX_LENGTH }, allow_blank: true
end
