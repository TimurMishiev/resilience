require "rails_helper"

RSpec.describe Feeds::PollMetrics, type: :service do
  before do
    Feeds::HealthRegistry.reset!
    allow(Rails.logger).to receive(:info)
  end

  it "records a snapshot in the health registry with the latest external timestamp" do
    metrics = described_class.new(feed: "acled")
    metrics.increment(:query_box_count, 2)
    metrics.increment(:page_count, 3)
    metrics.increment(:fetched_count, 7)
    metrics.increment(:ingested_count, 4)
    metrics.observe_external_time(Time.zone.parse("2026-03-25T12:00:00Z"))
    metrics.observe_external_time(Time.zone.parse("2026-03-26T18:30:00Z"))

    snapshot = metrics.finish(status: "ok")

    expect(snapshot[:feed]).to eq("acled")
    expect(snapshot[:status]).to eq("ok")
    expect(snapshot[:query_box_count]).to eq(2)
    expect(snapshot[:page_count]).to eq(3)
    expect(snapshot[:fetched_count]).to eq(7)
    expect(snapshot[:ingested_count]).to eq(4)
    expect(snapshot[:last_external_occurred_at]).to eq("2026-03-26T18:30:00Z")
    expect(Feeds::HealthRegistry.all).to include(snapshot)
    expect(Rails.logger).to have_received(:info).with(include("[FeedHealth]"))
  end

  it "records disabled feed snapshots with the standard health shape" do
    snapshot = described_class.record_disabled(feed: "ais", errors: ["AISHUB_USERNAME not configured"])

    expect(snapshot).to include(
      feed: "ais",
      status: "disabled",
      fetched_count: 0,
      ingested_count: 0,
      duplicate_count: 0,
      skipped_count: 0,
      error_count: 0,
      page_count: 0,
      query_box_count: 0,
      error_messages: ["AISHUB_USERNAME not configured"],
    )
    expect(Feeds::HealthRegistry.all).to include(snapshot)
    expect(Rails.logger).to have_received(:info).with(include("status=disabled"))
  end
end
