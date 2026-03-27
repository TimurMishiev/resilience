require "rails_helper"

RSpec.describe "Api::FeedHealth", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }

  before do
    Feeds::HealthRegistry.reset!
    Feeds::HealthRegistry.record(
      feed: "acled",
      status: "ok",
      started_at: "2026-03-27T01:00:00.000Z",
      finished_at: "2026-03-27T01:00:01.000Z",
      duration_ms: 1000,
      fetched_count: 12,
      ingested_count: 3,
      duplicate_count: 2,
      skipped_count: 1,
      error_count: 0,
      page_count: 2,
      query_box_count: 3,
    )
    Feeds::PollMetrics.record_disabled(feed: "ais", errors: ["AISHUB_USERNAME not configured"])
  end

  after do
    Feeds::HealthRegistry.reset!
  end

  it "requires authentication" do
    get "/api/feed_health"

    expect(response).to have_http_status(:unauthorized)
  end

  it "returns 403 for operators" do
    get "/api/feed_health", headers: auth_headers(operator)

    expect(response).to have_http_status(:forbidden)
  end

  it "returns the latest feed-health snapshots for commanders" do
    get "/api/feed_health", headers: auth_headers(commander)

    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    expect(body["data"]).to contain_exactly(
      include(
        "feed" => "acled",
        "status" => "ok",
        "fetched_count" => 12,
        "ingested_count" => 3,
        "page_count" => 2,
      ),
      include(
        "feed" => "ais",
        "status" => "disabled",
        "fetched_count" => 0,
        "ingested_count" => 0,
        "error_messages" => ["AISHUB_USERNAME not configured"],
      ),
    )
  end
end
