FactoryBot.define do
  factory :recommendation do
    recommendation_type { "acknowledge_alert" }
    tier                { "rule" }
    status              { "pending" }
    confidence          { 0.85 }
    rationale           { "Test rationale for this recommendation." }
    evidence            { [{ "type" => "alert", "id" => SecureRandom.uuid, "detail" => "conf=0.85" }] }
    action_payload      { { "alert_id" => SecureRandom.uuid, "to_status" => "acknowledged" } }
    affected_entity_type { "SignalRuleMatch" }
    affected_entity_id  { SecureRandom.uuid }
    expires_at          { 2.hours.from_now }

    trait :llm do
      tier       { "llm" }
      expires_at { 4.hours.from_now }
    end

    trait :accepted do
      status { "accepted" }
    end

    trait :rejected do
      status { "rejected" }
    end

    trait :expired do
      status     { "expired" }
      expires_at { 1.hour.ago }
    end

    trait :executed do
      status      { "executed" }
      executed_at { Time.current }
    end

    trait :for_incident do
      recommendation_type  { "escalate_incident" }
      affected_entity_type { "Incident" }
      action_payload       { { "incident_id" => SecureRandom.uuid, "to_status" => "acknowledged" } }
    end

    trait :for_site do
      recommendation_type  { "flag_site" }
      affected_entity_type { "Site" }
      action_payload       { { "site_id" => SecureRandom.uuid } }
    end
  end
end
