FactoryBot.define do
  factory :signal_rule_match do
    association :signal,           factory: :external_signal
    association :correlation_rule
    association :site
    fired_at { Time.current }
    metadata { { "distance_km" => 42.5, "signal_type" => "seismic_event", "signal_source" => "usgs_seismic", "actions_taken" => ["create_task"] } }

    after(:build) do |match|
      if match.task_id.nil?
        task = create(:task, site: match.site)
        match.task_id = task.id
      end
    end
  end
end
