class IncidentNote < ApplicationRecord
  # Append-only operational notes on an incident.
  # Notes are immutable once created — the full log is the historical record.
  # Each creation also writes an AuditEvent via Incidents::NoteService.
  MAX_BODY_LENGTH = 2_000

  belongs_to :incident
  belongs_to :author, class_name: "User"

  validates :body, presence: true, length: { maximum: MAX_BODY_LENGTH }

  # Chronological order — oldest first so the log reads top-to-bottom
  default_scope { order(created_at: :asc) }

  # ── Immutability enforcement ──────────────────────────────────────────────
  # Rails raises ActiveRecord::ReadOnlyRecord on any save/update attempt
  # against a persisted record, making the append-only invariant structural.
  def readonly?
    persisted?
  end

  # destroy bypasses readonly?, so we block it at the callback level too.
  before_destroy do
    raise ActiveRecord::ReadOnlyRecord,
          "IncidentNote records are immutable and cannot be deleted"
  end
end
