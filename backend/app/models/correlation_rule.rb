class CorrelationRule < ApplicationRecord
  VALID_SIGNAL_TYPES = %w[aircraft_position vessel_position seismic_event gps_jamming wildfire].freeze
  VALID_ACTION_TYPES = %w[create_task escalate_task flag_site].freeze
  VALID_PRIORITIES   = %w[low normal high critical].freeze

  belongs_to :created_by, class_name: "User"
  belongs_to :area_of_operation, optional: true
  has_many :signal_rule_matches, dependent: :destroy

  validates :name,             presence: true
  validates :cooldown_minutes, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :conditions,       presence: true
  validates :actions,          presence: true
  validate  :conditions_schema
  validate  :actions_schema

  scope :active, -> { where(is_active: true) }

  def on_cooldown?
    return false if last_fired_at.nil?
    last_fired_at > cooldown_minutes.minutes.ago
  end

  private

  def conditions_schema
    return unless conditions.is_a?(Hash)

    if (st = conditions["signal_type"]).present?
      unless VALID_SIGNAL_TYPES.include?(st)
        errors.add(:conditions, "signal_type '#{st}' is not a recognised signal type (#{VALID_SIGNAL_TYPES.join(', ')})")
      end
    end

    if (pkm = conditions["proximity_km"]).present?
      unless pkm.is_a?(Numeric) && pkm >= 0
        errors.add(:conditions, "proximity_km must be a non-negative number")
      end
    end

    if (ct = conditions["count_threshold"]).present?
      unless ct.is_a?(Integer) && ct >= 1
        errors.add(:conditions, "count_threshold must be a positive integer")
      end
    end

    if (tw = conditions["time_window_minutes"]).present?
      unless tw.is_a?(Integer) && tw >= 1
        errors.add(:conditions, "time_window_minutes must be a positive integer")
      end
    end

    if (mm = conditions["magnitude_min"]).present?
      unless mm.is_a?(Numeric) && mm >= 0
        errors.add(:conditions, "magnitude_min must be a non-negative number")
      end
    end
  end

  def actions_schema
    return unless actions.is_a?(Hash)

    if actions.empty?
      errors.add(:actions, "must contain at least one action (#{VALID_ACTION_TYPES.join(', ')})")
      return
    end

    actions.each_key do |key|
      unless VALID_ACTION_TYPES.include?(key)
        errors.add(:actions, "unknown action type '#{key}' — valid types: #{VALID_ACTION_TYPES.join(', ')}")
      end
    end

    if (ct = actions["create_task"]).present?
      unless ct.is_a?(Hash)
        errors.add(:actions, "create_task must be a hash")
      else
        if (p = ct["priority"]).present? && !VALID_PRIORITIES.include?(p)
          errors.add(:actions, "create_task.priority '#{p}' must be one of #{VALID_PRIORITIES.join(', ')}")
        end
      end
    end

    if (et = actions["escalate_task"]).present?
      unless et.is_a?(Hash)
        errors.add(:actions, "escalate_task must be a hash")
      else
        if (p = et["min_priority"]).present? && !VALID_PRIORITIES.include?(p)
          errors.add(:actions, "escalate_task.min_priority '#{p}' must be one of #{VALID_PRIORITIES.join(', ')}")
        end
      end
    end

    if (fs = actions["flag_site"]).present? && !fs.is_a?(Hash)
      errors.add(:actions, "flag_site must be a hash")
    end
  end
end
