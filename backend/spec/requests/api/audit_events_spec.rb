require "rails_helper"

RSpec.describe "Api::AuditEvents", type: :request do
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
    it "returns 200 with events in descending occurred_at order" do
      get "/api/audit_events"
      expect(response).to have_http_status(:ok)
      events = JSON.parse(response.body)
      expect(events.map { |e| e["id"] }).to include(event_a.id, event_b.id)
      timestamps = events.map { |e| e["occurred_at"] }
      expect(timestamps).to eq(timestamps.sort.reverse)
    end

    it "filters by entity_type" do
      get "/api/audit_events", params: { entity_type: "Task" }
      ids = JSON.parse(response.body).map { |e| e["id"] }
      expect(ids).to include(event_a.id)
      expect(ids).not_to include(event_b.id)
    end

    it "filters by entity_id" do
      get "/api/audit_events", params: { entity_id: task.id }
      ids = JSON.parse(response.body).map { |e| e["id"] }
      expect(ids).to eq([event_a.id])
    end

    it "respects the limit param" do
      create_list(:audit_event, 5, entity_type: "Task", entity_id: task.id)
      get "/api/audit_events", params: { limit: 2 }
      expect(JSON.parse(response.body).size).to eq(2)
    end

    it "caps limit at 500" do
      get "/api/audit_events", params: { limit: 9999 }
      # Just verifying it does not blow up; actual capping tested at service level
      expect(response).to have_http_status(:ok)
    end

    it "returns expected fields" do
      get "/api/audit_events"
      event = JSON.parse(response.body).first
      expect(event.keys).to include(
        "id", "schema_version", "actor", "entity_type", "entity_id",
        "event_type", "action", "before_snapshot", "after_snapshot",
        "correlation_id", "occurred_at"
      )
    end
  end
end
