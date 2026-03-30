class ProsecutionStep < ApplicationRecord
  VALID_PHASES = %w[assessing executing concluded].freeze
  VALID_ACTION_TYPES = %w[phase_transition evidence_linked outcome_recorded note_added].freeze

  # ── Associations ─────────────────────────────────────────────────────────────
  belongs_to :incident
  belongs_to :actor, class_name: "User"

  # ── Validations ──────────────────────────────────────────────────────────────
  validates :phase,       presence: true, inclusion: { in: VALID_PHASES }
  validates :action_type, presence: true, inclusion: { in: VALID_ACTION_TYPES }
  validates :occurred_at, presence: true
  validate  :evidence_refs_schema

  # ── Immutability ─────────────────────────────────────────────────────────────
  # Steps are an append-only prosecution log.
  # The schema has no updated_at column, which enforces immutability structurally.
  # This callback is a second line of defence at the model layer.
  before_update { throw :abort }

  # ── Scopes ───────────────────────────────────────────────────────────────────
  scope :for_incident, ->(id) { where(incident_id: id).order(occurred_at: :asc, created_at: :asc) }
  scope :by_phase,     ->(p)  { where(phase: p) }

  private

  # evidence_refs must be a hash where every value is an array of strings.
  # Valid:   { "signal_ids" => ["abc", "def"], "task_ids" => [] }
  # Invalid: { "signal_ids" => "abc" }  or  { "task_ids" => [123] }
  def evidence_refs_schema
    return errors.add(:evidence_refs, "must be a hash") unless evidence_refs.is_a?(Hash)

    evidence_refs.each do |key, val|
      unless val.is_a?(Array)
        errors.add(:evidence_refs, "#{key} must be an array")
        next
      end
      unless val.all? { |v| v.is_a?(String) }
        errors.add(:evidence_refs, "#{key} must be an array of strings")
      end
    end
  end
end
