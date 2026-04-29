class Site < ApplicationRecord
  STATUSES = %w[active inactive].freeze

  # Organization nullability — intentional-with-trigger, not legacy drift.
  #
  # The current production deploy (resilience-ops.fly.dev) seeds zero
  # Organizations: the seed creates Sites/AOs/users without ever calling
  # Organization.create, so the system runs effectively single-tenant
  # (every site has nil organization_id; every user is unrestricted via
  # ApplicationPolicy::Scope#site_scope's no-filter branch). The full
  # multi-tenant infrastructure (policies, scopes, broadcaster filter,
  # audit org-attribution) exists and is exercised by the request specs
  # — it's just not turned on by the deployed data shape.
  #
  # `optional: true` is correct for this state. Adding NOT NULL today
  # would force the seed to invent a synthetic "Default Organization"
  # purely to satisfy the constraint — mechanism without meaning. The
  # constraint becomes load-bearing the moment real Organizations exist
  # in production; until then it's premature.
  #
  # Trigger condition for promotion to NOT NULL:
  #   - first real Organization created in production beyond a single
  #     demo org, OR
  #   - any sites.organization_id IS NULL row blocks tenant-isolation
  #     behavior in observed operator-visible flow.
  # Promotion path:
  #   1. Backfill nil-org sites/AOs to a real Organization (per-AO
  #      assignment if multi-org, single-org assignment if portfolio).
  #   2. Migration: ALTER TABLE sites ALTER COLUMN organization_id SET NOT NULL.
  #   3. Drop `optional: true` from this belongs_to.
  #   4. Update :site factory to associate :organization by default.
  #
  # Same architectural shape applies to AreaOfOperation#organization_id —
  # see area_of_operation.rb for its mirror comment.
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
