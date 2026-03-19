class VesselTrack < ApplicationRecord
  # ── Associations ────────────────────────────────────────────────────────────
  belongs_to :vessel

  # ── Immutability ─────────────────────────────────────────────────────────────
  # Track points are historical facts. Once written they must not change.
  # This callback enforces that at the model layer — the DB has no updated_at
  # column, which enforces it structurally at the schema layer.
  before_update { throw :abort }

  # ── Validations ─────────────────────────────────────────────────────────────
  validates :lat,         presence: true, numericality: { greater_than_or_equal_to: -90,  less_than_or_equal_to: 90  }
  validates :lng,         presence: true, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }
  validates :occurred_at, presence: true

  # ── Scopes ──────────────────────────────────────────────────────────────────

  # Time-bounded track query — the primary read pattern for the globe/map.
  # Returns positions in chronological order.
  scope :between, ->(from, to) {
    where(occurred_at: from..to).order(:occurred_at)
  }

  # Retention scope — all rows eligible for deletion.
  scope :older_than, ->(duration) {
    where("occurred_at < ?", duration.ago)
  }
end
