class AreaOfOperation < ApplicationRecord
  self.table_name = "areas_of_operation"

  THREAT_LEVELS = %w[green amber red black].freeze
  POSTURES      = %w[observe defensive weapons_free].freeze

  belongs_to :created_by, class_name: "User"
  has_many :sites,             dependent: :nullify
  has_many :correlation_rules, dependent: :nullify
  has_one  :commander_intent,  dependent: :destroy
  has_one  :pace_plan,         dependent: :destroy
  has_many :salute_reports,    dependent: :destroy

  validates :name,         presence: true
  validates :threat_level, inclusion: { in: THREAT_LEVELS }
  validates :posture,      inclusion: { in: POSTURES }
  validates :geometry,     presence: true
  validates :color,        presence: true,
                           format: { with: /\A#[0-9a-fA-F]{6}\z/,
                                     message: "must be a 6-digit hex color (e.g. #ff4757)" }

  scope :by_threat,   ->(level)   { where(threat_level: level) }
  scope :by_posture,  ->(posture) { where(posture: posture) }

  # Returns true when kinetic asset actions are permitted.
  def weapons_free? = posture == "weapons_free"

  # Returns true when any asset assignment is permitted.
  def assignment_allowed? = posture != "observe"
end
