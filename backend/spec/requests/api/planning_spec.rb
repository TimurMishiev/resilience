require "rails_helper"

RSpec.describe "Api::Planning", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:ao) { create(:area_of_operation, name: "EUCOM", posture: "observe") }
  let!(:site) { create(:site, area_of_operation: ao) }
  let!(:asset) { create(:asset, name: "Asset Alpha", status: "available") }

  let!(:open_task) do
    create(:task, site: site, workflow_status: "new", priority: "high", title: "Patrol perimeter")
  end
  let!(:resolved_task) do
    create(:task, :resolved, site: site, title: "Old patrol")
  end

  describe "GET /api/planning" do
    it "returns 403 for operator role" do
      get "/api/planning", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 200 with required top-level keys for commander" do
      get "/api/planning", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.keys).to include("tasks", "assets", "areas_of_operation", "open_incidents", "meta")
    end

    it "excludes resolved tasks from the tasks array" do
      get "/api/planning", headers: auth_headers(commander)
      ids = JSON.parse(response.body)["tasks"].map { |t| t["id"] }
      expect(ids).to include(open_task.id)
      expect(ids).not_to include(resolved_task.id)
    end

    it "includes site_name, ao_id, and ao_posture on each task" do
      get "/api/planning", headers: auth_headers(commander)
      task_json = JSON.parse(response.body)["tasks"].find { |t| t["id"] == open_task.id }
      expect(task_json["site_name"]).to eq(site.name)
      expect(task_json["ao_id"]).to eq(ao.id)
      expect(task_json["ao_posture"]).to eq("observe")
    end

    it "returns nil ao_id and ao_posture for tasks whose site has no AO" do
      orphan_site = create(:site)
      orphan_task = create(:task, site: orphan_site, workflow_status: "new")
      get "/api/planning", headers: auth_headers(commander)
      task_json = JSON.parse(response.body)["tasks"].find { |t| t["id"] == orphan_task.id }
      expect(task_json["ao_id"]).to be_nil
      expect(task_json["ao_posture"]).to be_nil
    end

    it "returns ao_posture reflecting current posture value" do
      ao.update!(posture: "weapons_free")
      get "/api/planning", headers: auth_headers(commander)
      task_json = JSON.parse(response.body)["tasks"].find { |t| t["id"] == open_task.id }
      expect(task_json["ao_posture"]).to eq("weapons_free")
    end

    it "includes a meta block with truncated and task_count" do
      get "/api/planning", headers: auth_headers(commander)
      meta = JSON.parse(response.body)["meta"]
      expect(meta).to include("truncated", "task_count")
      expect(meta["truncated"]).to be(false)
    end

    it "excludes closed incidents from open_incidents" do
      incident = create(:incident, site: site, status: "closed", severity: "high")
      open_inc = create(:incident, site: site, status: "open", severity: "critical")
      get "/api/planning", headers: auth_headers(commander)
      ids = JSON.parse(response.body)["open_incidents"].map { |i| i["id"] }
      expect(ids).to include(open_inc.id)
      expect(ids).not_to include(incident.id)
    end
  end
end
