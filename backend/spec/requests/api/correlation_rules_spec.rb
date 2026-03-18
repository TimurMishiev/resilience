require "rails_helper"

RSpec.describe "Api::CorrelationRules", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:rule_active)   { create(:correlation_rule, name: "Active Rule",   is_active: true) }
  let!(:rule_inactive) { create(:correlation_rule, name: "Inactive Rule", is_active: false) }

  describe "GET /api/correlation_rules" do
    it "returns 200 with data array and pagination meta" do
      get "/api/correlation_rules", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns both active and inactive rules by default" do
      get "/api/correlation_rules", headers: auth_headers(commander)
      ids = JSON.parse(response.body)["data"].map { |r| r["id"] }
      expect(ids).to include(rule_active.id, rule_inactive.id)
    end

    it "filters to active-only rules with ?active_only=true" do
      get "/api/correlation_rules", params: { active_only: "true" }, headers: auth_headers(commander)
      ids = JSON.parse(response.body)["data"].map { |r| r["id"] }
      expect(ids).to include(rule_active.id)
      expect(ids).not_to include(rule_inactive.id)
    end

    it "returns expected fields on each record" do
      get "/api/correlation_rules", headers: auth_headers(commander)
      rule = JSON.parse(response.body)["data"].first
      expect(rule.keys).to include(
        "id", "name", "description", "is_active",
        "cooldown_minutes", "conditions", "actions",
        "last_fired_at", "created_at"
      )
    end

    it "is accessible to operators" do
      get "/api/correlation_rules", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
    end

    it "requires authentication" do
      get "/api/correlation_rules"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/correlation_rules/:id" do
    it "returns 200 with the rule" do
      get "/api/correlation_rules/#{rule_active.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["id"]).to eq(rule_active.id)
      expect(body["name"]).to eq("Active Rule")
      expect(body["conditions"]).to be_a(Hash)
      expect(body["actions"]).to be_a(Hash)
    end

    it "returns 404 for unknown UUID" do
      get "/api/correlation_rules/#{SecureRandom.uuid}", headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/correlation_rules" do
    let(:valid_params) do
      {
        correlation_rule: {
          name:             "New Rule",
          description:      "Fires on seismic events",
          is_active:        true,
          cooldown_minutes: 120,
          conditions:       { signal_type: "seismic_event", proximity_km: 50 },
          actions:          { create_task: { title: "Alert", priority: "high" } }
        }
      }
    end

    it "returns 201 and creates the rule for commanders" do
      expect {
        post "/api/correlation_rules", params: valid_params,
             headers: auth_headers(commander), as: :json
      }.to change(CorrelationRule, :count).by(1)
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["name"]).to eq("New Rule")
    end

    it "sets created_by to the current user" do
      post "/api/correlation_rules", params: valid_params,
           headers: auth_headers(commander), as: :json
      created_id = JSON.parse(response.body)["id"]
      expect(CorrelationRule.find(created_id).created_by_id).to eq(commander.id)
    end

    it "returns 403 for operators" do
      post "/api/correlation_rules", params: valid_params,
           headers: auth_headers(operator), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 422 when name is missing" do
      post "/api/correlation_rules",
           params:  { correlation_rule: valid_params[:correlation_rule].except(:name) },
           headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).not_to be_empty
    end
  end

  describe "PATCH /api/correlation_rules/:id" do
    it "returns 200 with updated fields for commanders" do
      patch "/api/correlation_rules/#{rule_active.id}",
            params:  { correlation_rule: { name: "Renamed", is_active: false } },
            headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("Renamed")
      expect(body["is_active"]).to be false
    end

    it "returns 403 for operators" do
      patch "/api/correlation_rules/#{rule_active.id}",
            params:  { correlation_rule: { name: "Renamed" } },
            headers: auth_headers(operator), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 404 for unknown UUID" do
      patch "/api/correlation_rules/#{SecureRandom.uuid}",
            params:  { correlation_rule: { name: "X" } },
            headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/correlation_rules/:id" do
    it "returns 204 and destroys the rule for commanders" do
      expect {
        delete "/api/correlation_rules/#{rule_inactive.id}", headers: auth_headers(commander)
      }.to change(CorrelationRule, :count).by(-1)
      expect(response).to have_http_status(:no_content)
    end

    it "returns 403 for operators" do
      delete "/api/correlation_rules/#{rule_inactive.id}", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 404 for unknown UUID" do
      delete "/api/correlation_rules/#{SecureRandom.uuid}", headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end
end
