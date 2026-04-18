require "rails_helper"

RSpec.describe "Api::AuditEvents", type: :request do
  let(:current_user) { create(:user, :commander) }
  let(:operator)     { create(:user, :operator) }
  let!(:site) { create(:site) }
  let!(:task) { create(:task, site: site) }

  let!(:event_a) do
    create(:audit_event,
           entity_type: "Task",
           entity_id: task.id,
           event_type: "task.created",
           occurred_at: 2.hours.ago)
  end

  let!(:event_b) do
    create(:audit_event,
           entity_type: "Site",
           entity_id: site.id,
           event_type: "site.created",
           occurred_at: 3.hours.ago)
  end

  describe "GET /api/audit_events" do
    it "requires authentication" do
      get "/api/audit_events"

      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 200 with events in descending occurred_at order" do
      get "/api/audit_events", headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
      events = JSON.parse(response.body)
      expect(events.map { |e| e["id"] }).to include(event_a.id, event_b.id)
      timestamps = events.map { |e| e["occurred_at"] }
      expect(timestamps).to eq(timestamps.sort.reverse)
    end

    it "filters by entity_type" do
      get "/api/audit_events", params: { entity_type: "Task" }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body).map { |e| e["id"] }
      expect(ids).to include(event_a.id)
      expect(ids).not_to include(event_b.id)
    end

    it "filters by entity_id" do
      get "/api/audit_events", params: { entity_id: task.id }, headers: auth_headers(current_user)
      ids = JSON.parse(response.body).map { |e| e["id"] }
      expect(ids).to eq([event_a.id])
    end

    it "respects the limit param" do
      create_list(:audit_event, 5, entity_type: "Task", entity_id: task.id)
      get "/api/audit_events", params: { limit: 2 }, headers: auth_headers(current_user)
      expect(JSON.parse(response.body).size).to eq(2)
    end

    it "caps limit at 500" do
      get "/api/audit_events", params: { limit: 9999 }, headers: auth_headers(current_user)
      expect(response).to have_http_status(:ok)
    end

    it "filters by as_of" do
      get "/api/audit_events",
          params: { as_of: 150.minutes.ago.iso8601 },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to contain_exactly(event_b.id)
    end

    it "filters by from / to time range" do
      get "/api/audit_events",
          params: { from: 150.minutes.ago.iso8601, to: 30.minutes.ago.iso8601 },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to contain_exactly(event_a.id)
    end

    it "ignores invalid from / to values" do
      get "/api/audit_events",
          params: { from: "not-a-date", to: "also-bad" },
          headers: auth_headers(current_user)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to include(event_a.id, event_b.id)
    end

    it "filters by event_types array" do
      get "/api/audit_events",
          params: { event_types: ["task.created"] },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to contain_exactly(event_a.id)
    end

    it "filters by entity_types array for cross-entity queries" do
      get "/api/audit_events",
          params: { entity_types: %w[Task Site] },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to include(event_a.id, event_b.id)
    end

    it "excludes events with non-matching entity_types" do
      get "/api/audit_events",
          params: { entity_types: ["Site"] },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to include(event_b.id)
      expect(ids).not_to include(event_a.id)
    end

    it "forbids operators from using entity_types without a scoped entity" do
      get "/api/audit_events",
          params: { entity_types: ["Task"] },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "ignores entity_types when entity_type and entity_id are both present" do
      get "/api/audit_events",
          params: { entity_type: "Task", entity_id: task.id, entity_types: ["Site"] },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to contain_exactly(event_a.id)
    end

    it "applies as_of and to independently — tighter bound wins" do
      # as_of=1h ago alone would include both events; to=2.5h ago is tighter, so only event_b qualifies
      get "/api/audit_events",
          params: { as_of: 1.hour.ago.iso8601, to: 2.5.hours.ago.iso8601 },
          headers: auth_headers(current_user)

      ids = JSON.parse(response.body).map { |event| event["id"] }
      expect(ids).to contain_exactly(event_b.id)
    end

    it "returns expected fields" do
      get "/api/audit_events", headers: auth_headers(current_user)
      event = JSON.parse(response.body).first
      expect(event.keys).to include(
        "id", "schema_version", "actor", "entity_type", "entity_id",
        "event_type", "action", "before_snapshot", "after_snapshot",
        "correlation_id", "occurred_at"
      )
    end

    it "allows operators to query entity-scoped audit history" do
      get "/api/audit_events",
          params: { entity_id: task.id, entity_type: "Task" },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).map { |event| event["id"] }).to eq([event_a.id])
    end

    it "forbids operators from querying the global audit log" do
      get "/api/audit_events", headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end
end
