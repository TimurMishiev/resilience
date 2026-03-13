class AuditEvent < ApplicationRecord
  # AuditEvent is append-only. No updates, no deletes.
  # All mutations are forbidden at the model level.
  after_initialize :freeze_if_persisted

  validates :schema_version, presence: true
  validates :actor, presence: true
  validates :entity_type, presence: true
  validates :entity_id, presence: true
  validates :event_type, presence: true
  validates :after_snapshot, presence: true
  validates :correlation_id, presence: true
  validates :occurred_at, presence: true

  scope :for_entity, ->(type, id) { where(entity_type: type, entity_id: id).order(:occurred_at) }
  scope :up_to, ->(timestamp) { where("occurred_at <= ?", timestamp) }

  private

  def freeze_if_persisted
    readonly! if persisted?
  end
end
