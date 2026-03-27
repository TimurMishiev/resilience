require "rails_helper"

RSpec.describe "Api::Planning", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:ao) { create(:area_of_operation, name: "EUCOM", posture: "observe") }
  let!(:site) { create(:site, area_of_operation: ao) }
  let!(:asset) { create(:asset, name: "Asset Alpha", status: "available") }
  let!(:chokepoint) { create(:chokepoint, area_of_operation: ao, name: "Strait Gate", status: "constrained") }
  let!(:commander_intent) { create(:commander_intent, area_of_operation: ao, title: "Hold corridor") }
  let!(:pace_plan) { create(:pace_plan, area_of_operation: ao, primary_plan: "SATCOM primary") }
  let!(:salute_report) { create(:salute_report, area_of_operation: ao, site: site, activity: "Observed shadowing pattern") }

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
      expect(body.keys).to include(
        "tasks",
        "assets",
        "areas_of_operation",
        "chokepoints",
        "commander_intents",
        "pace_plans",
        "salute_reports",
        "open_incidents",
        "meta"
      )
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

    it "includes a meta block with task and incident truncation metadata" do
      get "/api/planning", headers: auth_headers(commander)
      meta = JSON.parse(response.body)["meta"]
      expect(meta).to include(
        "truncated",
        "task_count",
        "incidents_truncated",
        "incident_count",
        "salute_reports_truncated",
        "salute_report_count",
        "salute_report_meta_by_ao"
      )
      expect(meta["truncated"]).to be(false)
      expect(meta["incidents_truncated"]).to be(false)
    end

    it "includes planning doctrine records in the aggregate payload" do
      get "/api/planning", headers: auth_headers(commander)
      body = JSON.parse(response.body)

      expect(body["chokepoints"].first["name"]).to eq("Strait Gate")
      expect(body["commander_intents"].first["title"]).to eq("Hold corridor")
      expect(body["pace_plans"].first["primary_plan"]).to eq("SATCOM primary")
      expect(body["salute_reports"].first["activity"]).to eq("Observed shadowing pattern")
    end

    it "retains per-AO SALUTE history when another AO exceeds the slice limit" do
      crowded_ao = create(:area_of_operation, name: "Crowded AO")
      55.times do |i|
        create(
          :salute_report,
          area_of_operation: crowded_ao,
          observed_at: Time.zone.parse("2026-03-27 12:00:00 UTC") - i.minutes,
          activity: "Crowded activity #{i}"
        )
      end
      calm_ao = create(:area_of_operation, name: "Calm AO")
      calm_report = create(
        :salute_report,
        area_of_operation: calm_ao,
        observed_at: Time.zone.parse("2026-03-20 12:00:00 UTC"),
        activity: "Calm AO reporting"
      )

      get "/api/planning", headers: auth_headers(commander)
      body = JSON.parse(response.body)

      expect(body["salute_reports"].map { |report| report["id"] }).to include(calm_report.id)
      expect(body.dig("meta", "salute_report_meta_by_ao", crowded_ao.id, "truncated")).to be(true)
      expect(body.dig("meta", "salute_report_meta_by_ao", crowded_ao.id, "count")).to eq(50)
      expect(body.dig("meta", "salute_report_meta_by_ao", calm_ao.id, "truncated")).to be(false)
      expect(body.dig("meta", "salute_report_meta_by_ao", calm_ao.id, "count")).to eq(1)
    end

    it "excludes closed incidents from open_incidents" do
      incident = create(:incident, site: site, status: "closed", severity: "high")
      open_inc = create(:incident, site: site, status: "open", severity: "critical")
      get "/api/planning", headers: auth_headers(commander)
      ids = JSON.parse(response.body)["open_incidents"].map { |i| i["id"] }
      expect(ids).to include(open_inc.id)
      expect(ids).not_to include(incident.id)
    end

    it "marks incident results truncated when open incidents exceed the planning cap" do
      create_list(:incident, 205, site: site, status: "open", severity: "critical")

      get "/api/planning", headers: auth_headers(commander)
      body = JSON.parse(response.body)

      expect(body["open_incidents"].size).to eq(200)
      expect(body.dig("meta", "incidents_truncated")).to be(true)
      expect(body.dig("meta", "incident_count")).to eq(200)
    end

    it "returns per-AO SALUTE reports so one AO cannot starve another" do
      ao2   = create(:area_of_operation, name: "Southern Arc")
      site2 = create(:site, area_of_operation: ao2)

      # Flood AO1 with reports up to the per-AO limit
      stub_const("Api::PlanningController::SALUTE_LIMIT", 3)
      create_list(:salute_report, 3, area_of_operation: ao, site: site, activity: "AO1 contact")

      # AO2 has a single report that must survive
      ao2_report = create(:salute_report, area_of_operation: ao2, site: site2, activity: "AO2 contact")

      get "/api/planning", headers: auth_headers(commander)
      body = JSON.parse(response.body)

      ao2_reports = body["salute_reports"].select { |r| r["area_of_operation_id"] == ao2.id }
      expect(ao2_reports.map { |r| r["id"] }).to include(ao2_report.id)
    end
  end
end
