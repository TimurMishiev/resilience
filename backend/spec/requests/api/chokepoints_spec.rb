require "rails_helper"

RSpec.describe "Api::Chokepoints", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator) { create(:user, :operator) }
  let(:ao) { create(:area_of_operation, name: "Northern Gulf") }

  describe "GET /api/chokepoints" do
    let!(:ao_chokepoint) { create(:chokepoint, area_of_operation: ao, name: "Hormuz East") }
    let!(:other_chokepoint) { create(:chokepoint, name: "Bab el-Mandeb West") }

    it "returns chokepoints with pagination metadata" do
      get "/api/chokepoints", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"].first).to include("area_of_operation_name", "category", "status", "watch_radius_km")
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "filters by area_of_operation_id" do
      get "/api/chokepoints", params: { area_of_operation_id: ao.id }, headers: auth_headers(operator)

      names = JSON.parse(response.body)["data"].map { |record| record["name"] }
      expect(names).to eq(["Hormuz East"])
    end

    it "reconstructs historical chokepoints as_of and excludes future updates" do
      cutoff = 30.minutes.ago.change(usec: 0)
      ao_chokepoint.update_columns(created_at: 3.hours.ago, updated_at: 3.hours.ago)

      create(
        :audit_event,
        actor: "system",
        entity_type: "AreaOfOperation",
        entity_id: ao.id,
        event_type: "area_of_operation_created",
        before_snapshot: nil,
        after_snapshot: {
          name: "Northern Gulf",
          description: ao.description,
          threat_level: ao.threat_level,
          posture: ao.posture,
          color: ao.color,
          geometry: ao.geometry,
        },
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        actor: "system",
        entity_type: "Chokepoint",
        entity_id: ao_chokepoint.id,
        event_type: "chokepoint.created",
        before_snapshot: {},
        after_snapshot: {
          area_of_operation_id: ao.id,
          name: "Hormuz East",
          category: ao_chokepoint.category,
          status: "monitor",
          latitude: ao_chokepoint.latitude,
          longitude: ao_chokepoint.longitude,
          watch_radius_km: ao_chokepoint.watch_radius_km,
          notes: "Initial watch posture",
        },
        occurred_at: cutoff - 90.minutes,
      )
      create(
        :audit_event,
        actor: "system",
        entity_type: "Chokepoint",
        entity_id: ao_chokepoint.id,
        event_type: "chokepoint.updated",
        before_snapshot: {
          status: "monitor",
          notes: "Initial watch posture",
        },
        after_snapshot: {
          status: "closed",
          notes: "Future closure",
        },
        occurred_at: cutoff + 5.minutes,
      )

      get "/api/chokepoints", params: { as_of: cutoff.iso8601 }, headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      record = JSON.parse(response.body)["data"].find { |row| row["id"] == ao_chokepoint.id }
      expect(record).to include(
        "name" => "Hormuz East",
        "status" => "monitor",
        "notes" => "Initial watch posture",
        "area_of_operation_name" => "Northern Gulf",
      )
    end
  end

  describe "GET /api/chokepoints/:id" do
    let!(:chokepoint) { create(:chokepoint, area_of_operation: ao, name: "Replay Strait") }

    it "returns historical chokepoint state as_of" do
      cutoff = 20.minutes.ago.change(usec: 0)
      chokepoint.update_columns(created_at: 3.hours.ago, updated_at: 3.hours.ago)

      create(
        :audit_event,
        actor: "system",
        entity_type: "AreaOfOperation",
        entity_id: ao.id,
        event_type: "area_of_operation_created",
        before_snapshot: nil,
        after_snapshot: {
          name: "Northern Gulf",
          description: ao.description,
          threat_level: ao.threat_level,
          posture: ao.posture,
          color: ao.color,
          geometry: ao.geometry,
        },
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        actor: "system",
        entity_type: "Chokepoint",
        entity_id: chokepoint.id,
        event_type: "chokepoint.created",
        before_snapshot: {},
        after_snapshot: {
          area_of_operation_id: ao.id,
          name: "Replay Strait",
          category: chokepoint.category,
          status: "constrained",
          latitude: chokepoint.latitude,
          longitude: chokepoint.longitude,
          watch_radius_km: chokepoint.watch_radius_km,
          notes: "Historical note",
        },
        occurred_at: cutoff - 90.minutes,
      )
      create(
        :audit_event,
        actor: "system",
        entity_type: "Chokepoint",
        entity_id: chokepoint.id,
        event_type: "chokepoint.updated",
        before_snapshot: { status: "constrained" },
        after_snapshot: { status: "closed" },
        occurred_at: cutoff + 1.minute,
      )

      get "/api/chokepoints/#{chokepoint.id}", params: { as_of: cutoff.iso8601 }, headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to include(
        "id" => chokepoint.id,
        "status" => "constrained",
        "notes" => "Historical note",
        "area_of_operation_name" => "Northern Gulf",
      )
    end
  end

  describe "POST /api/chokepoints" do
    let(:valid_params) do
      {
        chokepoint: {
          area_of_operation_id: ao.id,
          name: "Hormuz East",
          category: "strait",
          status: "contested",
          latitude: 25.9,
          longitude: 56.1,
          watch_radius_km: 18,
          notes: "Escalating boarding pattern near outbound lane.",
        }
      }
    end

    it "creates a chokepoint and writes an audit event" do
      expect {
        post "/api/chokepoints", params: valid_params, headers: auth_headers(commander)
      }.to change(Chokepoint, :count).by(1).and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["status"]).to eq("contested")
      expect(AuditEvent.last.event_type).to eq("chokepoint.created")
    end

    it "broadcasts an SSE event with chokepoint_name and area_of_operation_name" do
      broadcaster = instance_double(Sse::Broadcaster)
      allow(Sse::Broadcaster).to receive(:instance).and_return(broadcaster)
      allow(broadcaster).to receive(:publish)

      post "/api/chokepoints", params: valid_params, headers: auth_headers(commander)

      expect(broadcaster).to have_received(:publish).with(
        hash_including(
          event: "chokepoint_updated",
          data: hash_including(
            kind: "created",
            chokepoint_name: "Hormuz East",
            area_of_operation_name: "Northern Gulf"
          )
        )
      )
    end

    it "forbids operators" do
      post "/api/chokepoints", params: valid_params, headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/chokepoints/:id" do
    let!(:chokepoint) { create(:chokepoint, area_of_operation: ao) }

    it "updates the chokepoint and writes an audit event" do
      patch "/api/chokepoints/#{chokepoint.id}",
            params: { chokepoint: { status: "closed", notes: "Transit suspended." } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("closed")
      expect(AuditEvent.last.event_type).to eq("chokepoint.updated")
    end

    it "rejects area_of_operation_id reassignment on update" do
      other_ao = create(:area_of_operation, name: "Southern Arc")

      patch "/api/chokepoints/#{chokepoint.id}",
            params: { chokepoint: { area_of_operation_id: other_ao.id, status: "constrained" } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to include("area_of_operation_id cannot be changed")
      expect(chokepoint.reload.area_of_operation_id).to eq(ao.id)
    end
  end

  describe "DELETE /api/chokepoints/:id" do
    let!(:chokepoint) { create(:chokepoint, area_of_operation: ao) }

    it "deletes the chokepoint and writes an audit event" do
      expect {
        delete "/api/chokepoints/#{chokepoint.id}", headers: auth_headers(commander)
      }.to change(Chokepoint, :count).by(-1).and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:no_content)
      expect(AuditEvent.last.event_type).to eq("chokepoint.deleted")
    end
  end
end
