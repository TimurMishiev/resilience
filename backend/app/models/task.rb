class Task < ApplicationRecord
  WORKFLOW_STATUSES = %w[new triaged in_progress blocked resolved].freeze
  PRIORITIES = %w[low normal high critical].freeze

  belongs_to :site
  belongs_to :asset, optional: true

  validates :title, presence: true
  validates :workflow_status, inclusion: { in: WORKFLOW_STATUSES }
  validates :priority, inclusion: { in: PRIORITIES }
  validate :blocked_reason_consistency

  # resolved_at is set by the transition service when entering resolved state.
  # Immutability is enforced in TransitionService (only sets it when nil?).
  # attr_readonly cannot be used here because it blocks the initial assignment too.

  scope :by_status, ->(status) { where(workflow_status: status) }
  scope :blocked, -> { where(workflow_status: "blocked") }
  scope :resolved, -> { where(workflow_status: "resolved") }

  private

  def blocked_reason_consistency
    if workflow_status == "blocked" && blocked_reason.blank?
      errors.add(:blocked_reason, "must be present when task is blocked")
    elsif workflow_status != "blocked" && blocked_reason.present?
      errors.add(:blocked_reason, "must be blank unless task is blocked")
    end
  end
end
