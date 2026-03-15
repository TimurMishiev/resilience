class AreaOfOperation < ApplicationRecord
  self.table_name = "areas_of_operation"

  THREAT_LEVELS = %w[green amber red black].freeze

  belongs_to :created_by, class_name: "User"
  has_many :sites,             dependent: :nullify
  has_many :correlation_rules, dependent: :nullify

  validates :name,         presence: true
  validates :threat_level, inclusion: { in: THREAT_LEVELS }
  validates :geometry,     presence: true
  validates :color,        presence: true,
                           format: { with: /\A#[0-9a-fA-F]{6}\z/,
                                     message: "must be a 6-digit hex color (e.g. #ff4757)" }

  scope :by_threat, ->(level) { where(threat_level: level) }
end
