class OperationalStatus < ApplicationRecord
  CATEGORIES = %w[feed_health job_health relay_health].freeze

  validates :category, presence: true, inclusion: { in: CATEGORIES }
  validates :key, presence: true, uniqueness: { scope: :category }
  validates :payload, presence: true

  scope :ordered, -> { order(:category, :key) }
  scope :for_category, ->(category) { where(category: category).order(:key) }

  def self.record!(category:, key:, payload:)
    timestamp = Time.current

    upsert(
      {
        category: category,
        key: key,
        payload: payload,
        created_at: timestamp,
        updated_at: timestamp,
      },
      unique_by: :idx_operational_statuses_category_key
    )
  end
end
