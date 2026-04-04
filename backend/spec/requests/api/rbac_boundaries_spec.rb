require "rails_helper"

# RBAC boundary tests — systematically verify that role-based access control
# prevents unauthorized actions at the HTTP level. These complement the Pundit
# policy unit specs by testing the full request → controller → policy path.
RSpec.describe "RBAC boundary enforcement", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }
  let(:viewer)    { create(:user, :viewer) }

  let!(:site) { create(:site, name: "Bravo") }
  let!(:task) { create(:task, site: site, title: "Patrol") }
  let!(:incident) do
    create(:incident, site: site, title: "Contact", severity: "high",
           area_of_operation: site.area_of_operation)
  end
  let!(:recommendation) do
    create(:recommendation, :for_site,
           affected_entity_id: site.id,
           action_payload: { "site_id" => site.id },
           expires_at: 2.hours.from_now)
  end
  let!(:rule) do
    create(:correlation_rule,
           area_of_operation: site.area_of_operation,
           name: "Test Rule")
  end
  let!(:match) do
    create(:signal_rule_match,
           site: site,
           task: task,
           incident: incident,
           correlation_rule: rule,
           metadata: {
             "distance_km" => 5.0,
             "signal_type" => "seismic_event",
             "signal_source" => "usgs_seismic",
             "actions_taken" => ["create_task"],
           })
  end

  # ─── 1. Viewer cannot write ─────────────────────────────────────────────

  describe "viewer write restrictions" do
    it "cannot create tasks" do
      post "/api/tasks",
           params: { task: { site_id: site.id, title: "Blocked", priority: "high" } },
           headers: auth_headers(viewer),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot transition tasks" do
      post "/api/tasks/#{task.id}/transition",
           params: { transition: { to_status: "triaged" } },
           headers: auth_headers(viewer),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot update tasks" do
      patch "/api/tasks/#{task.id}",
            params: { task: { title: "Changed" } },
            headers: auth_headers(viewer),
            as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot transition incidents" do
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "acknowledged" },
           headers: auth_headers(viewer),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot update incidents" do
      patch "/api/incidents/#{incident.id}",
            params: { incident: { title: "Changed" } },
            headers: auth_headers(viewer),
            as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot add incident notes" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "Hello" },
           headers: auth_headers(viewer),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot assign incidents" do
      patch "/api/incidents/#{incident.id}/assign",
            params: { assignee_id: viewer.id },
            headers: auth_headers(viewer),
            as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot transition alerts" do
      post "/api/signal_rule_matches/#{match.id}/transition",
           params: { signal_rule_match: { workflow_status: "acknowledged" } },
           headers: auth_headers(viewer),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "can still read tasks" do
      get "/api/tasks", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
    end

    it "can still read incidents" do
      get "/api/incidents", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
    end

    it "can still read sites" do
      get "/api/sites", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
    end

    it "can still read alerts" do
      get "/api/signal_rule_matches", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
    end
  end

  # ─── 2. Operator cannot access commander-only actions ───────────────────

  describe "operator commander-only restrictions" do
    it "cannot toggle site status" do
      patch "/api/sites/#{site.id}/toggle_status",
            headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot unflag site" do
      patch "/api/sites/#{site.id}/unflag",
            headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot update geofence" do
      patch "/api/sites/#{site.id}/update_geofence",
            params: { geofence_radius_km: 25 },
            headers: auth_headers(operator),
            as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot create correlation rules" do
      post "/api/correlation_rules",
           params: {
             correlation_rule: {
               name: "Operator Rule",
               cooldown_minutes: 30,
               area_of_operation_id: site.area_of_operation_id,
               conditions: { signal_type: "seismic_event", proximity_km: 25 },
               actions: { create_task: { title: "Test", priority: "high" } },
             },
           },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot delete correlation rules" do
      delete "/api/correlation_rules/#{rule.id}",
             headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot accept recommendations" do
      post "/api/recommendations/#{recommendation.id}/accept",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot reject recommendations" do
      post "/api/recommendations/#{recommendation.id}/reject",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot defer recommendations" do
      post "/api/recommendations/#{recommendation.id}/defer",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot execute recommendations" do
      post "/api/recommendations/#{recommendation.id}/execute",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot generate recommendations" do
      post "/api/recommendations/generate",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot initiate prosecution" do
      post "/api/incidents/#{incident.id}/prosecute",
           params: {
             prosecution_step: {
               phase: "assessing",
               action_type: "identify",
               description: "Initial assessment",
             },
           },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot use AI filter" do
      get "/api/ai/filter",
          params: { query: "show me recent tasks" },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot use AI summary" do
      post "/api/ai/summary",
           params: { mode: "leadership" },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "cannot use ontology query" do
      post "/api/ai/ontology_query",
           params: { query: "show site relationships" },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "can still create tasks (operator-level action)" do
      post "/api/tasks",
           params: { task: { site_id: site.id, title: "Patrol Route B", priority: "normal" } },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:created)
    end

    it "can still transition tasks" do
      post "/api/tasks/#{task.id}/transition",
           params: { transition: { to_status: "triaged" } },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:ok)
    end

    it "can still transition incidents" do
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "acknowledged" },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:ok)
    end

    it "can still add incident notes" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "Operator note" },
           headers: auth_headers(operator),
           as: :json

      expect(response).to have_http_status(:created)
    end
  end

  # ─── 3. Unauthenticated access ─────────────────────────────────────────

  describe "unauthenticated access" do
    it "rejects requests without authorization header" do
      get "/api/sites"
      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects requests with invalid token" do
      get "/api/sites", headers: { "Authorization" => "Bearer invalid.token.here" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects requests with expired token" do
      expired_token = JWT.encode(
        { sub: commander.id, role: commander.role,
          exp: 1.hour.ago.to_i, iat: 2.hours.ago.to_i, jti: SecureRandom.uuid },
        JwtAuthenticatable::SECRET,
        JwtAuthenticatable::ALGORITHM
      )
      get "/api/sites", headers: { "Authorization" => "Bearer #{expired_token}" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects requests with globally revoked token" do
      commander.update!(tokens_valid_after: Time.current)
      token = JWT.encode(
        { sub: commander.id, role: commander.role,
          exp: 1.hour.from_now.to_i, iat: 2.minutes.ago.to_i, jti: SecureRandom.uuid },
        JwtAuthenticatable::SECRET,
        JwtAuthenticatable::ALGORITHM
      )
      get "/api/sites", headers: { "Authorization" => "Bearer #{token}" }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  # ─── 4. Commander has full access ───────────────────────────────────────

  describe "commander full access" do
    it "can toggle site status" do
      patch "/api/sites/#{site.id}/toggle_status",
            headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
    end

    it "can create correlation rules" do
      post "/api/correlation_rules",
           params: {
             correlation_rule: {
               name: "Commander Rule",
               cooldown_minutes: 30,
               area_of_operation_id: site.area_of_operation_id,
               conditions: { signal_type: "seismic_event", proximity_km: 25 },
               actions: { create_task: { title: "Respond", priority: "high" } },
             },
           },
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:created)
    end

    it "can accept recommendations" do
      post "/api/recommendations/#{recommendation.id}/accept",
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
    end
  end
end
