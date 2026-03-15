class SignalRuleMatch < ApplicationRecord
  belongs_to :signal, class_name: "ExternalSignal", foreign_key: :signal_id
  belongs_to :correlation_rule
  belongs_to :site,  optional: true
  belongs_to :task,  optional: true

  validates :fired_at, presence: true

  scope :recent, ->(hours = 24) { where(fired_at: hours.hours.ago..Time.current) }
  scope :for_rule, ->(rule_id)  { where(correlation_rule_id: rule_id) }
  scope :for_site, ->(site_id)  { where(site_id: site_id) }
end
