FactoryBot.define do
  factory :signal_rule_match do
    association :signal,           factory: :external_signal
    association :correlation_rule
    association :site
    fired_at   { Time.current }
    confidence { 0.8 }
    metadata   { { "distance_km" => 42.5, "signal_type" => "seismic_event", "signal_source" => "usgs_seismic", "actions_taken" => ["create_task"] } }

    # Set auto_task: false (or use :without_task trait) when testing matches that
    # should NOT have a linked task — e.g. effectiveness analytics tests where
    # task_creation_rate should reflect a < 1.0 ratio.
    transient do
      auto_task { true }
    end

    after(:build) do |match, evaluator|
      if match.task_id.nil? && evaluator.auto_task
        task = create(:task, site: match.site)
        match.task_id = task.id
      end
    end

    trait :without_task do
      auto_task { false }
    end
  end
end
