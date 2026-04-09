require "rails_helper"

RSpec.describe "API scoped access", type: :request do
  let(:org_a) { create(:organization) }
  let(:org_b) { create(:organization) }
  let(:ao_owner_a) { create(:user, :commander, organization: org_a) }
  let(:ao_owner_b) { create(:user, :commander, organization: org_b) }
  let(:ao_a)  { create(:area_of_operation, name: "AO Alpha", organization: org_a, created_by: ao_owner_a) }
  let(:ao_b)  { create(:area_of_operation, name: "AO Bravo", organization: org_b, created_by: ao_owner_b) }

  let!(:site_a) { create(:site, organization: org_a, area_of_operation: ao_a, name: "Alpha") }
  let!(:site_b) { create(:site, organization: org_b, area_of_operation: ao_b, name: "Bravo") }

  let!(:task_a) { create(:task, site: site_a, title: "Task Alpha") }
  let!(:task_b) { create(:task, site: site_b, title: "Task Bravo") }

  let!(:asset_a) { create(:asset, name: "Asset Alpha", home_site: site_a) }
  let!(:asset_b) { create(:asset, name: "Asset Bravo", home_site: site_b) }

  let!(:incident_a) { create(:incident, site: site_a, area_of_operation: ao_a, title: "Incident Alpha") }
  let!(:incident_b) { create(:incident, site: site_b, area_of_operation: ao_b, title: "Incident Bravo") }

  let!(:rule_a) { create(:correlation_rule, area_of_operation: ao_a, name: "Rule Alpha") }
  let!(:rule_b) { create(:correlation_rule, area_of_operation: ao_b, name: "Rule Bravo") }

  let!(:match_a) do
    create(
      :signal_rule_match,
      :without_task,
      site: site_a,
      task: task_a,
      incident: incident_a,
      correlation_rule: rule_a,
      metadata: {
        "distance_km" => 12.5,
        "signal_type" => "seismic_event",
        "signal_source" => "sensor_a",
        "actions_taken" => ["create_task"],
      }
    )
  end

  let!(:match_b) do
    create(
      :signal_rule_match,
      :without_task,
      site: site_b,
      task: task_b,
      incident: incident_b,
      correlation_rule: rule_b,
      metadata: {
        "distance_km" => 18.0,
        "signal_type" => "seismic_event",
        "signal_source" => "sensor_b",
        "actions_taken" => ["create_task"],
      }
    )
  end

  let!(:breach_a) do
    create(
      :signal_rule_match,
      :without_task,
      site: site_a,
      incident: incident_a,
      correlation_rule: nil,
      metadata: {
        "geofence_breach" => true,
        "distance_km" => 2.5,
        "signal_type" => "vessel_position",
        "signal_source" => "ais",
      }
    )
  end

  let!(:breach_b) do
    create(
      :signal_rule_match,
      :without_task,
      site: site_b,
      incident: incident_b,
      correlation_rule: nil,
      metadata: {
        "geofence_breach" => true,
        "distance_km" => 3.5,
        "signal_type" => "vessel_position",
        "signal_source" => "ais",
      }
    )
  end

  let!(:audit_task_a) { create(:audit_event, entity_type: "Task", entity_id: task_a.id, event_type: "task.created") }
  let!(:audit_task_b) { create(:audit_event, entity_type: "Task", entity_id: task_b.id, event_type: "task.created") }

  let!(:recommendation_a) do
    create(
      :recommendation,
      :for_site,
      affected_entity_id: site_a.id,
      action_payload: { "site_id" => site_a.id },
      expires_at: 2.hours.from_now
    )
  end

  let!(:recommendation_b) do
    create(
      :recommendation,
      :for_site,
      affected_entity_id: site_b.id,
      action_payload: { "site_id" => site_b.id },
      expires_at: 2.hours.from_now
    )
  end

  let(:scoped_viewer) do
    create(:user, :viewer, organization: org_a, area_of_operation: ao_a)
  end

  let(:org_scoped_viewer) do
    create(:user, :viewer, organization: org_a, area_of_operation: nil)
  end

  let(:scoped_operator) do
    create(:user, :operator, organization: org_a, area_of_operation: ao_a)
  end

  let(:scoped_commander) do
    create(:user, :commander, organization: org_a, area_of_operation: ao_a)
  end

  describe "scoped reads" do
    it "limits sites to the user's organization and AO" do
      get "/api/sites", headers: auth_headers(scoped_viewer)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |site| site.fetch("id") }).to eq([site_a.id])

      get "/api/sites/#{site_b.id}", headers: auth_headers(scoped_viewer)
      expect(response).to have_http_status(:not_found)
    end

    it "allows org-scoped users to read org-null global areas of operation" do
      global_ao = create(:area_of_operation, name: "AO Global Shared")

      get "/api/areas_of_operation", headers: auth_headers(org_scoped_viewer)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |area| area.fetch("id") }).to contain_exactly(ao_a.id, global_ao.id)

      get "/api/areas_of_operation/#{global_ao.id}", headers: auth_headers(org_scoped_viewer)
      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("id")).to eq(global_ao.id)
    end

    it "limits tasks to scoped sites" do
      get "/api/tasks", headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |task| task.fetch("id") }).to contain_exactly(task_a.id)

      get "/api/tasks/#{task_b.id}", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:not_found)
    end

    it "limits assets to scoped home sites" do
      get "/api/assets", headers: auth_headers(scoped_viewer)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |asset| asset.fetch("id") }).to contain_exactly(asset_a.id)

      get "/api/assets/#{asset_b.id}", headers: auth_headers(scoped_viewer)
      expect(response).to have_http_status(:not_found)
    end

    it "limits incidents to scoped sites and AOs" do
      get "/api/incidents", headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |incident| incident.fetch("id") }).to contain_exactly(incident_a.id)

      get "/api/incidents/#{incident_b.id}", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:not_found)
    end

    it "limits alert collections and breach-site aggregates" do
      get "/api/signal_rule_matches", headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |match| match.fetch("id") }).to include(match_a.id, breach_a.id)
      expect(json_body.fetch("data").map { |match| match.fetch("id") }).not_to include(match_b.id, breach_b.id)

      get "/api/signal_rule_matches/#{match_b.id}", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:not_found)

      get "/api/signal_rule_matches/active_breach_sites", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("site_ids")).to eq([site_a.id])
    end

    it "allows entity-scoped audit access only for in-scope entities" do
      get "/api/audit_events",
          params: { entity_type: "Task", entity_id: task_a.id },
          headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:ok)
      expect(json_body.map { |event| event.fetch("id") }).to eq([audit_task_a.id])

      get "/api/audit_events",
          params: { entity_type: "Task", entity_id: task_b.id },
          headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:not_found)

      get "/api/audit_events", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "scopes global audit view to the commander's org across all entity types" do
      chokepoint_a = create(:chokepoint, area_of_operation: ao_a)
      chokepoint_b = create(:chokepoint, area_of_operation: ao_b)
      intent_a     = create(:commander_intent, area_of_operation: ao_a)
      intent_b     = create(:commander_intent, area_of_operation: ao_b)
      pace_a       = create(:pace_plan, area_of_operation: ao_a)
      pace_b       = create(:pace_plan, area_of_operation: ao_b)
      salute_a     = create(:salute_report, area_of_operation: ao_a, site: site_a)
      salute_b     = create(:salute_report, area_of_operation: ao_b, site: site_b)

      # Create audit events for every entity type in both orgs
      visible_events = [
        audit_task_a,
        create(:audit_event, entity_type: "Site",              entity_id: site_a.id,          event_type: "site.created"),
        create(:audit_event, entity_type: "AreaOfOperation",   entity_id: ao_a.id,            event_type: "ao.created"),
        create(:audit_event, entity_type: "Incident",          entity_id: incident_a.id,      event_type: "incident.created"),
        create(:audit_event, entity_type: "SignalRuleMatch",   entity_id: match_a.id,         event_type: "alert.fired"),
        create(:audit_event, entity_type: "CorrelationRule",   entity_id: rule_a.id,          event_type: "rule.created"),
        create(:audit_event, entity_type: "Asset",             entity_id: asset_a.id,         event_type: "asset.updated"),
        create(:audit_event, entity_type: "Chokepoint",        entity_id: chokepoint_a.id,    event_type: "chokepoint.created"),
        create(:audit_event, entity_type: "PacePlan",          entity_id: pace_a.id,          event_type: "pace_plan.created"),
        create(:audit_event, entity_type: "CommanderIntent",   entity_id: intent_a.id,        event_type: "intent.created"),
        create(:audit_event, entity_type: "SaluteReport",      entity_id: salute_a.id,        event_type: "salute.created"),
        create(:audit_event, entity_type: "Recommendation",    entity_id: recommendation_a.id, event_type: "rec.created"),
      ]

      hidden_events = [
        audit_task_b,
        create(:audit_event, entity_type: "Site",              entity_id: site_b.id,          event_type: "site.created"),
        create(:audit_event, entity_type: "AreaOfOperation",   entity_id: ao_b.id,            event_type: "ao.created"),
        create(:audit_event, entity_type: "Incident",          entity_id: incident_b.id,      event_type: "incident.created"),
        create(:audit_event, entity_type: "SignalRuleMatch",   entity_id: match_b.id,         event_type: "alert.fired"),
        create(:audit_event, entity_type: "CorrelationRule",   entity_id: rule_b.id,          event_type: "rule.created"),
        create(:audit_event, entity_type: "Asset",             entity_id: asset_b.id,         event_type: "asset.updated"),
        create(:audit_event, entity_type: "Chokepoint",        entity_id: chokepoint_b.id,    event_type: "chokepoint.created"),
        create(:audit_event, entity_type: "PacePlan",          entity_id: pace_b.id,          event_type: "pace_plan.created"),
        create(:audit_event, entity_type: "CommanderIntent",   entity_id: intent_b.id,        event_type: "intent.created"),
        create(:audit_event, entity_type: "SaluteReport",      entity_id: salute_b.id,        event_type: "salute.created"),
        create(:audit_event, entity_type: "Recommendation",    entity_id: recommendation_b.id, event_type: "rec.created"),
      ]

      get "/api/audit_events", headers: auth_headers(scoped_commander)

      expect(response).to have_http_status(:ok)
      returned_ids = json_body.map { |e| e.fetch("id") }

      visible_events.each do |event|
        expect(returned_ids).to include(event.id),
          "expected #{event.entity_type} event #{event.id} to be visible but it was excluded"
      end

      hidden_events.each do |event|
        expect(returned_ids).not_to include(event.id),
          "expected #{event.entity_type} event #{event.id} to be hidden but it leaked through"
      end
    end

    it "scopes recommendations to visible entities" do
      get "/api/recommendations", headers: auth_headers(scoped_operator)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |rec| rec.fetch("id") }).to contain_exactly(recommendation_a.id)

      post "/api/recommendations/#{recommendation_b.id}/accept", headers: auth_headers(scoped_commander)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "scoped aggregate surfaces" do
    let!(:chokepoint_a) { create(:chokepoint, area_of_operation: ao_a) }
    let!(:chokepoint_b) { create(:chokepoint, area_of_operation: ao_b) }
    let!(:intent_a) { create(:commander_intent, area_of_operation: ao_a) }
    let!(:intent_b) { create(:commander_intent, area_of_operation: ao_b) }
    let!(:pace_a) { create(:pace_plan, area_of_operation: ao_a) }
    let!(:pace_b) { create(:pace_plan, area_of_operation: ao_b) }
    let!(:salute_a) { create(:salute_report, area_of_operation: ao_a, site: site_a) }
    let!(:salute_b) { create(:salute_report, area_of_operation: ao_b, site: site_b) }
    let!(:throughput_a) do
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task_a.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "resolved" },
        occurred_at: 1.day.ago
      )
    end
    let!(:throughput_b) do
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task_b.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "resolved" },
        occurred_at: 1.day.ago
      )
    end

    it "limits readiness and risk scores to visible sites" do
      get "/api/readiness", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:ok)
      expect(json_body["data"].map { |row| row.fetch("site_id") }).to eq([site_a.id])

      get "/api/risk_scores", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:ok)
      expect(json_body["data"].map { |row| row.fetch("site_id") }).to eq([site_a.id])
    end

    it "limits analytics to visible tasks and sites" do
      get "/api/analytics/throughput", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").sum { |row| row.fetch("resolved") }).to eq(1)

      get "/api/analytics/swimlane", headers: auth_headers(scoped_operator)
      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("data").map { |lane| lane.fetch("site_id") }).to all(eq(site_a.id))
    end

    it "limits planning payloads to the commander's visible AO" do
      get "/api/planning", headers: auth_headers(scoped_commander)

      expect(response).to have_http_status(:ok)
      expect(json_body.fetch("tasks").map { |task| task.fetch("id") }).to contain_exactly(task_a.id)
      expect(json_body.fetch("assets").map { |asset| asset.fetch("id") }).to contain_exactly(asset_a.id)
      expect(json_body.fetch("areas_of_operation").map { |area| area.fetch("id") }).to contain_exactly(ao_a.id)
      expect(json_body.fetch("chokepoints").map { |point| point.fetch("id") }).to contain_exactly(chokepoint_a.id)
      expect(json_body.fetch("commander_intents").map { |intent| intent.fetch("id") }).to contain_exactly(intent_a.id)
      expect(json_body.fetch("pace_plans").map { |plan| plan.fetch("id") }).to contain_exactly(pace_a.id)
      expect(json_body.fetch("salute_reports").map { |report| report.fetch("id") }).to contain_exactly(salute_a.id)
      expect(json_body.fetch("open_incidents").map { |incident| incident.fetch("id") }).to contain_exactly(incident_a.id)
    end
  end

  describe "scoped writes" do
    it "forbids task creation on out-of-scope sites" do
      post "/api/tasks",
           params: { task: { site_id: site_b.id, title: "Blocked", priority: "high" } },
           headers: auth_headers(scoped_operator),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids scoped commanders from creating global AOs" do
      post "/api/areas_of_operation",
           params: {
             area_of_operation: {
               name: "Out of Scope AO",
               threat_level: "green",
               color: "#23d160",
               geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids mutating existing org-null global AOs and attached doctrine" do
      global_ao = create(:area_of_operation, name: "AO Global Shared")
      org_scoped_commander = create(:user, :commander, organization: org_a, area_of_operation: nil)

      patch "/api/areas_of_operation/#{global_ao.id}",
            params: {
              area_of_operation: {
                name: "Updated Global AO",
              },
            },
            headers: auth_headers(org_scoped_commander),
            as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/correlation_rules",
           params: {
             correlation_rule: {
               name: "Global Rule",
               cooldown_minutes: 30,
               area_of_operation_id: global_ao.id,
               conditions: { signal_type: "seismic_event", proximity_km: 25 },
               actions: { create_task: { title: "Respond", priority: "high" } },
             },
           },
           headers: auth_headers(org_scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/chokepoints",
           params: {
             chokepoint: {
               area_of_operation_id: global_ao.id,
               name: "Global Strait",
               category: "strait",
               status: "monitor",
               latitude: 25.0,
               longitude: 56.0,
               watch_radius_km: 12.5,
             },
           },
           headers: auth_headers(org_scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/commander_intents",
           params: {
             commander_intent: {
               area_of_operation_id: global_ao.id,
               title: "Global Intent",
               objective: "Hold Global",
               end_state: "Global secure",
             },
           },
           headers: auth_headers(org_scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/pace_plans",
           params: {
             pace_plan: {
               area_of_operation_id: global_ao.id,
               primary_plan: "P",
               alternate_plan: "A",
               contingency_plan: "C",
               emergency_plan: "E",
             },
           },
           headers: auth_headers(org_scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/salute_reports",
           params: {
             salute_report: {
               area_of_operation_id: global_ao.id,
               activity: "Observed activity",
               location: "Grid 123",
               observed_at: Time.current.iso8601,
             },
           },
           headers: auth_headers(org_scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "forbids out-of-scope doctrine and rule creation" do
      post "/api/correlation_rules",
           params: {
             correlation_rule: {
               name: "Out of Scope Rule",
               cooldown_minutes: 30,
               area_of_operation_id: ao_b.id,
               conditions: { signal_type: "seismic_event", proximity_km: 25 },
               actions: { create_task: { title: "Respond", priority: "high" } },
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/chokepoints",
           params: {
             chokepoint: {
               area_of_operation_id: ao_b.id,
               name: "Blocked Strait",
               category: "strait",
               status: "monitor",
               latitude: 25.0,
               longitude: 56.0,
               watch_radius_km: 12.5,
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/commander_intents",
           params: {
             commander_intent: {
               area_of_operation_id: ao_b.id,
               title: "Intent Bravo",
               objective: "Hold Bravo",
               end_state: "Bravo secure",
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/pace_plans",
           params: {
             pace_plan: {
               area_of_operation_id: ao_b.id,
               primary_plan: "P",
               alternate_plan: "A",
               contingency_plan: "C",
               emergency_plan: "E",
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/salute_reports",
           params: {
             salute_report: {
               area_of_operation_id: ao_b.id,
               site_id: site_b.id,
               activity: "Observed activity",
               location: "Grid 123",
               observed_at: Time.current.iso8601,
             },
           },
           headers: auth_headers(scoped_commander),
           as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "forbids recommendation generation for scoped commanders until the generator is scope-aware" do
      post "/api/recommendations/generate", headers: auth_headers(scoped_commander)

      expect(response).to have_http_status(:forbidden)
    end
  end

  private

  def json_body
    JSON.parse(response.body)
  end
end
