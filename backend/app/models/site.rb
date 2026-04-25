class Site < ApplicationRecord
  STATUSES = %w[active inactive].freeze

  belongs_to :organization,       optional: true
  belongs_to :area_of_operation, optional: true

  has_many :tasks, dependent: :restrict_with_error
  has_many :assets, foreign_key: :home_site_id, dependent: :nullify, inverse_of: :home_site
  has_many :incidents,           dependent: :nullify
  has_many :signal_rule_matches, dependent: :nullify
  has_many :salute_reports,      dependent: :nullify
  has_many :site_risk_snapshots, dependent: :destroy

  validates :name, presence: true
  validates :latitude, presence: true, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }
  validates :longitude, presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :status, inclusion: { in: STATUSES }
  validates :geofence_radius_km, numericality: { greater_than: 0, less_than_or_equal_to: 2000 }
  validate :area_of_operation_matches_organization

  before_validation :sync_organization_from_area_of_operation

  scope :active,      -> { where(status: "active") }
  scope :flagged,     -> { where.not(flagged_at: nil) }
  scope :honeytokens, -> { where(honeytoken: true) }

  # honeytoken? predicate is a thin convenience over the column —
  # call sites read better as `site.honeytoken?` than
  # `site.honeytoken == true`. Used by Api::SitesController#show
  # to gate the ThreatDetection::HoneytokenAlertService trigger.

  private

  def sync_organization_from_area_of_operation
    return if area_of_operation.blank?
    return unless area_of_operation.respond_to?(:organization_id)
    return if area_of_operation.organization_id.blank?
    return if organization_id.present?

    self.organization_id = area_of_operation.organization_id
  end

  def area_of_operation_matches_organization
    return if area_of_operation.blank? || organization.blank?
    return unless area_of_operation.respond_to?(:organization_id)
    return if area_of_operation.organization_id.blank? || area_of_operation.organization_id == organization_id

    errors.add(:area_of_operation_id, "must belong to the same organization")
  end
end
