class CorrelationRule < ApplicationRecord
  belongs_to :created_by, class_name: "User"
  belongs_to :area_of_operation, optional: true
  has_many :signal_rule_matches, dependent: :destroy

  validates :name,             presence: true
  validates :cooldown_minutes, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :conditions,       presence: true
  validates :actions,          presence: true

  scope :active, -> { where(is_active: true) }

  def on_cooldown?
    return false if last_fired_at.nil?
    last_fired_at > cooldown_minutes.minutes.ago
  end
end
