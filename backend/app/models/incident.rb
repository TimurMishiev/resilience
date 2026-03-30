class Incident < ApplicationRecord
  VALID_STATUSES   = %w[open acknowledged contained resolved closed].freeze
  VALID_SEVERITIES = %w[low moderate high critical].freeze

  # Status → allowed next statuses
  TRANSITIONS = {
    "open"         => %w[acknowledged contained resolved closed],
    "acknowledged" => %w[contained resolved closed open],
    "contained"    => %w[resolved closed acknowledged],
    "resolved"     => %w[closed open],
    "closed"       => %w[open],
  }.freeze

  SEVERITY_ORDER   = %w[low moderate high critical].freeze
  VALID_PROSECUTION_PHASES = %w[assessing executing concluded].freeze

  belongs_to :site,               optional: true
  belongs_to :area_of_operation,  optional: true
  belongs_to :assigned_to,        class_name: "User", optional: true
  belongs_to :prosecuted_by,      class_name: "User", optional: true

  has_many :signal_rule_matches, dependent: :nullify
  has_many :tasks,   through: :signal_rule_matches
  has_many :signals, through: :signal_rule_matches, source: :signal
  # Incidents are operational records — they should not be casually deleted.
  # :restrict_with_exception makes the invariant explicit: any attempt to
  # destroy an incident with notes raises DeleteRestrictionError rather than
  # silently fighting the IncidentNote before_destroy guard.
  has_many :incident_notes,    dependent: :restrict_with_exception
  has_many :prosecution_steps, dependent: :destroy

  validates :title,     presence: true
  validates :status,    inclusion: { in: VALID_STATUSES }
  validates :severity,  inclusion: { in: VALID_SEVERITIES }
  validates :confidence, numericality: { greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0 }
  validates :opened_at, presence: true
  validates :prosecution_phase,
            inclusion: { in: VALID_PROSECUTION_PHASES },
            allow_nil: true

  scope :active,       -> { where.not(status: %w[resolved closed]) }
  scope :by_severity,  -> { order(Arel.sql("CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END")) }
  scope :recent,       -> { order(opened_at: :desc) }
  scope :for_site,     ->(id) { where(site_id: id) }
  scope :by_status,    ->(s)  { where(status: s) }

  # ── Helpers ─────────────────────────────────────────────────────────────────

  def allowed_transitions
    TRANSITIONS.fetch(status, [])
  end

  def severity_rank
    SEVERITY_ORDER.index(severity) || 0
  end

  # ── Prosecution helpers ──────────────────────────────────────────────────────

  def being_prosecuted?
    prosecution_phase.present?
  end

  def prosecution_concluded?
    prosecution_phase == "concluded"
  end
end
