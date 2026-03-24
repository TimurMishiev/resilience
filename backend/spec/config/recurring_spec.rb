require "rails_helper"
require "yaml"

RSpec.describe "config/recurring.yml" do
  let(:config) { YAML.load_file(Rails.root.join("config/recurring.yml")) }

  it "schedules telemetry partition maintenance in production" do
    production = config.fetch("production")

    expect(production).to include(
      "telemetry_prepare_partitions" => hash_including(
        "class" => "Telemetry::PreparePartitionsJob",
        "queue" => "background",
        "schedule" => "every day at 12:05am"
      ),
      "telemetry_prune_partitions" => hash_including(
        "class" => "Telemetry::PrunePartitionsJob",
        "queue" => "background",
        "schedule" => "every day at 4:20am"
      )
    )
  end
end
