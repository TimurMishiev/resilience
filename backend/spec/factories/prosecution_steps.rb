FactoryBot.define do
  factory :prosecution_step do
    association :incident
    association :actor, factory: :user

    phase       { "assessing" }
    action_type { "phase_transition" }
    notes       { nil }
    evidence_refs { {} }
    occurred_at { Time.current }

    trait :assessing do
      phase { "assessing" }
    end

    trait :executing do
      phase { "executing" }
    end

    trait :concluded do
      phase { "concluded" }
    end

    trait :with_notes do
      notes { "Operator note for this step" }
    end

    trait :with_evidence do
      action_type   { "evidence_linked" }
      evidence_refs { { "signal_ids" => ["sig-abc", "sig-def"] } }
    end
  end
end
