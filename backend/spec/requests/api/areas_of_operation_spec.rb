require "rails_helper"

RSpec.describe "Api::AreasOfOperation", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:eucom) { create(:area_of_operation, name: "EUCOM", threat_level: "amber", color: "#ffb347") }
  let!(:centcom) { create(:area_of_operation, name: "CENTCOM", threat_level: "red",   color: "#ff4757") }
  let!(:indopacom) { create(:area_of_operation, name: "INDOPACOM", threat_level: "green", color: "#23d160") }

  describe "GET /api/areas_of_operation" do
    it "returns 200 with data array and pagination meta" do
      get "/api/areas_of_operation", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns all AOs in name order" do
      get "/api/areas_of_operation", headers: auth_headers(commander)
      names = JSON.parse(response.body)["data"].map { |a| a["name"] }
      expect(names).to eq(names.sort)
    end

    it "filters by threat_level" do
      get "/api/areas_of_operation", params: { threat_level: "amber" }, headers: auth_headers(commander)
      ids = JSON.parse(response.body)["data"].map { |a| a["id"] }
      expect(ids).to eq([eucom.id])
    end

    it "returns expected fields on each record" do
      get "/api/areas_of_operation", headers: auth_headers(commander)
      area = JSON.parse(response.body)["data"].first
      expect(area.keys).to include(
        "id", "name", "description", "threat_level",
        "color", "geometry", "created_by", "created_at", "updated_at"
      )
    end

    it "is accessible to operators" do
      get "/api/areas_of_operation", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
    end
  end

  describe "GET /api/areas_of_operation/:id" do
    it "returns 200 with correct fields" do
      get "/api/areas_of_operation/#{eucom.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(eucom.id)
      expect(body["name"]).to eq("EUCOM")
      expect(body["threat_level"]).to eq("amber")
      expect(body["geometry"]).to be_a(Hash)
    end

    it "returns 404 for unknown UUID" do
      get "/api/areas_of_operation/#{SecureRandom.uuid}", headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/areas_of_operation" do
    let(:valid_params) do
      {
        area_of_operation: {
          name:         "New AO",
          threat_level: "green",
          color:        "#23d160",
          geometry:     { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
        }
      }
    end

    it "returns 201 and creates the AO for commanders" do
      expect {
        post "/api/areas_of_operation", params: valid_params, headers: auth_headers(commander), as: :json
      }.to change(AreaOfOperation, :count).by(1)
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("New AO")
      expect(body["geometry"]).to eq(valid_params[:area_of_operation][:geometry].deep_stringify_keys)
    end

    it "writes an audit event on create" do
      expect {
        post "/api/areas_of_operation", params: valid_params, headers: auth_headers(commander), as: :json
      }.to change(AuditEvent, :count).by(1)
      event = AuditEvent.last
      expect(event.event_type).to eq("area_of_operation_created")
      expect(event.before_snapshot).to be_nil
      expect(event.after_snapshot["name"]).to eq("New AO")
      expect(event.after_snapshot["geometry"]).to eq(valid_params[:area_of_operation][:geometry].deep_stringify_keys)
    end

    it "returns 403 for operators" do
      post "/api/areas_of_operation", params: valid_params, headers: auth_headers(operator), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "creates the AO inside the commander's organization scope" do
      organization = create(:organization)
      scoped_commander = create(:user, :commander, organization: organization)

      post "/api/areas_of_operation", params: valid_params, headers: auth_headers(scoped_commander), as: :json

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["organization_id"]).to eq(organization.id)
      expect(AreaOfOperation.order(:created_at).last.organization_id).to eq(organization.id)
    end

    it "returns 422 when name is missing" do
      post "/api/areas_of_operation",
           params:  { area_of_operation: valid_params[:area_of_operation].except(:name) },
           headers: auth_headers(commander),
           as:      :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /api/areas_of_operation/:id" do
    it "returns 200 with updated fields for commanders" do
      patch "/api/areas_of_operation/#{eucom.id}",
            params:  { area_of_operation: { threat_level: "red" } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["threat_level"]).to eq("red")
    end

    it "writes an audit event with before/after snapshot on update" do
      new_geometry = { type: "Polygon", coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] }

      expect {
        patch "/api/areas_of_operation/#{eucom.id}",
              params:  { area_of_operation: { threat_level: "red", geometry: new_geometry } },
              headers: auth_headers(commander),
              as:      :json
      }.to change(AuditEvent, :count).by(1)
      event = AuditEvent.last
      expect(event.event_type).to eq("area_of_operation_updated")
      expect(event.before_snapshot["threat_level"]).to eq("amber")
      expect(event.before_snapshot["geometry"]).to eq(eucom.geometry.deep_stringify_keys)
      expect(event.after_snapshot["threat_level"]).to eq("red")
      expect(event.after_snapshot["geometry"]).to eq(new_geometry.deep_stringify_keys)
    end

    it "returns 403 for operators" do
      patch "/api/areas_of_operation/#{eucom.id}",
            params:  { area_of_operation: { threat_level: "red" } },
            headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "DELETE /api/areas_of_operation/:id" do
    it "returns 204 and destroys an AO with no attached doctrine" do
      bare_ao = create(:area_of_operation, name: "Empty AO")
      delete "/api/areas_of_operation/#{bare_ao.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:no_content)
      expect(AreaOfOperation.find_by(id: bare_ao.id)).to be_nil
    end

    it "writes an audit event on successful delete" do
      bare_ao = create(:area_of_operation, name: "To Delete")
      expect {
        delete "/api/areas_of_operation/#{bare_ao.id}", headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)
      event = AuditEvent.last
      expect(event.event_type).to eq("area_of_operation_deleted")
      expect(event.before_snapshot["name"]).to eq("To Delete")
      expect(event.before_snapshot["geometry"]).to eq(bare_ao.geometry.deep_stringify_keys)
      expect(event.after_snapshot["deleted"]).to be true
      expect(event.after_snapshot["geometry"]).to eq(bare_ao.geometry.deep_stringify_keys)
    end

    it "returns 422 when AO has attached doctrine (commander_intent)" do
      create(:commander_intent, area_of_operation: indopacom, created_by: commander, updated_by: commander)
      delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to include("commander intent")
    end

    it "returns 422 when AO has attached doctrine (pace_plan)" do
      create(:pace_plan, area_of_operation: indopacom, created_by: commander, updated_by: commander)
      delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to include("pace plan")
    end

    it "returns 422 when AO has attached doctrine (chokepoints)" do
      create(:chokepoint, area_of_operation: indopacom, created_by: commander, updated_by: commander)
      delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to include("chokepoints")
    end

    it "returns 422 when AO has attached doctrine (salute_reports)" do
      create(:salute_report, area_of_operation: indopacom, created_by: commander)
      delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to include("salute reports")
    end

    it "does not write an audit event when destroy is blocked by attached doctrine" do
      create(:commander_intent, area_of_operation: indopacom, created_by: commander, updated_by: commander)
      expect {
        delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(commander)
      }.not_to change(AuditEvent, :count)
    end

    it "returns 403 for operators" do
      delete "/api/areas_of_operation/#{indopacom.id}", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/areas_of_operation/:id/posture" do
    it "updates posture and returns the area for commanders" do
      patch "/api/areas_of_operation/#{eucom.id}/posture",
            params:  { posture: "defensive" },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["posture"]).to eq("defensive")
      expect(body["posture_changed_at"]).not_to be_nil
    end

    it "writes an AuditEvent recording the before/after posture" do
      expect {
        patch "/api/areas_of_operation/#{eucom.id}/posture",
              params:  { posture: "weapons_free" },
              headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("posture_changed")
      expect(event.entity_type).to eq("AreaOfOperation")
      expect(event.entity_id).to eq(eucom.id)
      expect(event.before_snapshot["posture"]).to eq("observe")
      expect(event.after_snapshot["posture"]).to eq("weapons_free")
    end

    it "returns 403 for operators" do
      patch "/api/areas_of_operation/#{eucom.id}/posture",
            params:  { posture: "defensive" },
            headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 422 for an invalid posture value" do
      patch "/api/areas_of_operation/#{eucom.id}/posture",
            params:  { posture: "nuke_everything" },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["errors"].first).to match(/posture must be one of/)
    end

    it "returns the posture field in the serialized response" do
      patch "/api/areas_of_operation/#{eucom.id}/posture",
            params:  { posture: "observe" },
            headers: auth_headers(commander)
      body = JSON.parse(response.body)
      expect(body.keys).to include("posture", "posture_changed_at")
    end

    it "AOs default to observe posture" do
      expect(eucom.posture).to eq("observe")
    end
  end
end
