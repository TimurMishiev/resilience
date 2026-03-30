require "rails_helper"

RSpec.describe "Api::OperationalHealth", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator) { create(:user, :operator) }

  before do
    OperationalStatus.delete_all
    OperationalStatus.record!(
      category: "feed_health",
      key: "acled",
      payload: { status: "ok", feed: "acled" }
    )
    OperationalStatus.record!(
      category: "job_health",
      key: "telemetry_partitions",
      payload: { status: "ok", window_exhausts_on: "2026-04-05" }
    )
  end

  after do
    OperationalStatus.delete_all
  end

  it "requires authentication" do
    get "/api/operational_health"

    expect(response).to have_http_status(:unauthorized)
  end

  it "returns 403 for operators" do
    get "/api/operational_health", headers: auth_headers(operator)

    expect(response).to have_http_status(:forbidden)
  end

  it "returns ordered operational status records for commanders" do
    get "/api/operational_health", headers: auth_headers(commander)

    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    expect(body["data"]).to contain_exactly(
      include(
        "category" => "feed_health",
        "key" => "acled",
        "payload" => include("status" => "ok", "feed" => "acled")
      ),
      include(
        "category" => "job_health",
        "key" => "telemetry_partitions",
        "payload" => include("status" => "ok", "window_exhausts_on" => "2026-04-05")
      )
    )
  end
end
