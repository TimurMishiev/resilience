class SignalRuleMatch < ApplicationRecord
  VALID_ACTIONS = %w[create_task escalate_task flag_site].freeze

  belongs_to :signal, class_name: "ExternalSignal", foreign_key: :signal_id
  belongs_to :correlation_rule
  belongs_to :site,  optional: true
  belongs_to :task,  optional: true

  validates :fired_at,   presence: true
  validates :confidence, numericality: { greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0 }
  validate  :metadata_schema

  scope :recent,          ->(hours = 24) { where(fired_at: hours.hours.ago..Time.current) }
  scope :for_rule,        ->(rule_id)    { where(correlation_rule_id: rule_id) }
  scope :for_site,        ->(site_id)    { where(site_id: site_id) }
  scope :high_confidence, ->             { where("confidence >= ?", 0.7) }
  scope :by_confidence,   ->             { order(confidence: :desc) }

  private

  # Enforce a strict schema for the metadata JSON column.
  # Fields: distance_km (Numeric), signal_type (String), signal_source (String),
  #         actions_taken (Array of known action strings).
  def metadata_schema
    return errors.add(:metadata, "must be a hash") unless metadata.is_a?(Hash)

    unless metadata["distance_km"].is_a?(Numeric) && metadata["distance_km"] >= 0
      errors.add(:metadata, "distance_km must be a non-negative number")
    end

    unless metadata["signal_type"].is_a?(String) && metadata["signal_type"].present?
      errors.add(:metadata, "signal_type must be a non-empty string")
    end

    unless metadata["signal_source"].is_a?(String) && metadata["signal_source"].present?
      errors.add(:metadata, "signal_source must be a non-empty string")
    end

    actions = metadata["actions_taken"]
    unless actions.is_a?(Array) && actions.all? { |a| VALID_ACTIONS.include?(a) }
      errors.add(:metadata, "actions_taken must be an array of known action types")
    end
  end
end
