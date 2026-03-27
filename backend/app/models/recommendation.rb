class Recommendation < ApplicationRecord
  VALID_TYPES = %w[
    close_stale_alert
    acknowledge_alert
    escalate_incident
    create_task
    flag_site
    bulk_triage_alerts
    assign_asset
  ].freeze

  VALID_STATUSES = %w[pending accepted rejected deferred expired executed].freeze
  VALID_TIERS    = %w[rule llm].freeze

  EXPIRY_BY_TIER = {
    "rule" => 2.hours,
    "llm"  => 4.hours,
  }.freeze

  belongs_to :reviewer, class_name: "User", foreign_key: :reviewed_by_id, optional: true

  validates :recommendation_type, inclusion: { in: VALID_TYPES }
  validates :status,              inclusion: { in: VALID_STATUSES }
  validates :tier,                inclusion: { in: VALID_TIERS }
  validates :confidence,          numericality: { greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0 }
  validates :rationale,           presence: true
  validates :expires_at,          presence: true

  scope :pending,    -> { where(status: "pending") }
  scope :active,     -> { pending.where("expires_at > ?", Time.current) }
  scope :expired,    -> { pending.where("expires_at <= ?", Time.current) }
  scope :for_entity, ->(type, id) { where(affected_entity_type: type, affected_entity_id: id) }
  scope :by_tier,    ->(tier) { where(tier: tier) }
  scope :recent,     -> { order(created_at: :desc) }

  # Prevents duplicate pending recommendations for the same type + entity.
  # The application-level check is a fast-path read; the partial unique index
  # idx_recommendations_pending_dedup is the DB-level guarantee against races.
  # GeneratorService rescues RecordNotUnique to absorb concurrent duplicates.
  def self.duplicate_pending?(type:, entity_type:, entity_id:)
    pending.where(
      recommendation_type:  type,
      affected_entity_type: entity_type,
      affected_entity_id:   entity_id,
    ).exists?
  end

  def expire!
    update!(status: "expired")
  end

  def accept!(user:, reason: nil)
    update!(status: "accepted", reviewed_by_id: user.id, reviewed_at: Time.current, review_reason: reason)
  end

  def reject!(user:, reason: nil)
    update!(status: "rejected", reviewed_by_id: user.id, reviewed_at: Time.current, review_reason: reason)
  end

  def defer!(user:, reason: nil)
    update!(status: "deferred", reviewed_by_id: user.id, reviewed_at: Time.current, review_reason: reason)
  end

  def mark_executed!
    before_status = status
    ApplicationRecord.transaction do
      update!(status: "executed", executed_at: Time.current)
      Audit::EventWriter.write(
        actor:           "system",
        entity_type:     "Recommendation",
        entity_id:       id,
        event_type:      "recommendation_executed",
        before_snapshot: { status: before_status },
        after_snapshot:  { status: "executed" },
        correlation_id:  SecureRandom.uuid,
      )
    end
  end

  def pending?  = status == "pending"
  def accepted? = status == "accepted"
  def expired?  = status == "expired"
end
