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
end
