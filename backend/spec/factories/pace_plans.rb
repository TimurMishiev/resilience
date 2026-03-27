FactoryBot.define do
  factory :pace_plan do
    association :area_of_operation
    association :created_by, factory: [:user, :commander]
    association :updated_by, factory: [:user, :commander]
    primary_plan { "SATCOM mission chat" }
    alternate_plan { "Secure VHF relay" }
    contingency_plan { "Burst SMS via field gateway" }
    emergency_plan { "HF voice net and courier fallback" }
    notes { "Escalate to emergency plan if SATCOM latency exceeds 10 minutes." }
  end
end
