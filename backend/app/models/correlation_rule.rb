class CorrelationRule < ApplicationRecord
  VALID_SIGNAL_TYPES = %w[aircraft_position vessel_position seismic_event gps_jamming wildfire ais_gap conflict_event disaster_alert].freeze
  VALID_ACTION_TYPES = %w[create_task escalate_task flag_site].freeze
  VALID_PRIORITIES   = %w[low normal high critical].freeze
  VALID_OPERATORS    = %w[AND OR].freeze

  belongs_to :created_by, class_name: "User"
  belongs_to :area_of_operation, optional: true
  has_many :signal_rule_matches, dependent: :destroy

  validates :name,              presence: true
  validates :cooldown_minutes,  presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :conditions,        presence: true
  validates :actions,           presence: true
  validates :area_of_operation, presence: true, if: -> { area_of_operation_id.present? }
  validate  :conditions_schema
  validate  :actions_schema

  scope :active, -> { where(is_active: true) }

  # ── Public API ───────────────────────────────────────────────────────────────

  def on_cooldown?
    return false if last_fired_at.nil?
    last_fired_at > cooldown_minutes.minutes.ago
  end

  # Returns conditions in canonical compound form regardless of how they were stored.
  #
  # Legacy flat rule:
  #   { "signal_type" => "gps_jamming", "proximity_km" => 50 }
  #   → { "operator" => "AND", "conditions" => [{ "signal_type" => "gps_jamming", ... }] }
  #
  # Compound rule (already in canonical form):
  #   { "operator" => "AND", "conditions" => [...] }
  #   → returned unchanged
  #
  # This is the single coercion point. The EvaluatorService always calls
  # normalized_conditions — it never reads raw conditions directly.
  def normalized_conditions
    return conditions if compound?

    # Wrap legacy flat rule in a single-element AND.
    # Single-element AND is logically identical to the original rule.
    { "operator" => "AND", "conditions" => [ conditions ] }
  end

  # Is this a compound multi-signal rule?
  def compound?
    conditions.is_a?(Hash) && conditions["operator"].present?
  end

  def supported_condition_shape?
    normalized_conditions_supported?(normalized_conditions)
  end

  private

  # ── Validation ───────────────────────────────────────────────────────────────

  def conditions_schema
    return unless conditions.is_a?(Hash)

    if compound?
      validate_compound_conditions
    else
      validate_single_condition(conditions, "")
    end
  end

  def validate_compound_conditions
    op = conditions["operator"]
    unless VALID_OPERATORS.include?(op)
      errors.add(:conditions, "operator must be one of: #{VALID_OPERATORS.join(', ')}")
      return
    end

    conds = conditions["conditions"]
    unless conds.is_a?(Array) && conds.length >= 2
      errors.add(:conditions, "compound conditions must contain at least 2 condition objects")
      return
    end

    conds.each_with_index do |cond, i|
      unless cond.is_a?(Hash)
        errors.add(:conditions, "conditions[#{i}] must be a hash")
        next
      end
      validate_single_condition(cond, "conditions[#{i}].")
    end
  end

  # Validates a single flat condition hash.
  # prefix is used in error messages to indicate path in compound rules.
  def validate_single_condition(cond, prefix)
    if nested_compound_condition?(cond)
      errors.add(:conditions, "#{prefix}nested compound conditions are not supported")
      return
    end

    if (st = cond["signal_type"]).present?
      unless VALID_SIGNAL_TYPES.include?(st)
        errors.add(:conditions, "#{prefix}signal_type '#{st}' is not recognised (#{VALID_SIGNAL_TYPES.join(', ')})")
      end
    end

    if (pkm = cond["proximity_km"]).present?
      unless pkm.is_a?(Numeric) && pkm >= 0
        errors.add(:conditions, "#{prefix}proximity_km must be a non-negative number")
      end
    end

    if (ct = cond["count_threshold"]).present?
      unless ct.is_a?(Integer) && ct >= 1
        errors.add(:conditions, "#{prefix}count_threshold must be a positive integer")
      end
    end

    if (tw = cond["time_window_minutes"]).present?
      unless tw.is_a?(Integer) && tw >= 1
        errors.add(:conditions, "#{prefix}time_window_minutes must be a positive integer")
      end
    end

    if (mm = cond["magnitude_min"]).present?
      unless mm.is_a?(Numeric) && mm >= 0
        errors.add(:conditions, "#{prefix}magnitude_min must be a non-negative number")
      end
    end
  end

  def nested_compound_condition?(cond)
    cond.is_a?(Hash) && (cond["operator"].present? || cond.key?("conditions"))
  end

  def normalized_conditions_supported?(group)
    return false unless group.is_a?(Hash)

    operator = group["operator"]
    conds = group["conditions"]

    return false unless VALID_OPERATORS.include?(operator)
    return false unless conds.is_a?(Array) && conds.any?

    conds.all? { |cond| cond.is_a?(Hash) && !nested_compound_condition?(cond) }
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
