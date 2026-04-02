require "rails_helper"

RSpec.describe "Api::CorrelationRules", type: :request do
  include ActiveSupport::Testing::TimeHelpers

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

    it "writes an audit event on create" do
      expect {
        post "/api/correlation_rules", params: valid_params,
             headers: auth_headers(commander), as: :json
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("correlation_rule.created")
      expect(event.entity_type).to eq("CorrelationRule")
      expect(event.before_snapshot).to eq({})
      expect(event.after_snapshot).to include(
        "name" => "New Rule",
        "is_active" => true,
        "conditions" => valid_params[:correlation_rule][:conditions].deep_stringify_keys,
        "actions" => valid_params[:correlation_rule][:actions].deep_stringify_keys,
      )
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

    it "returns 422 when a nested compound group has fewer than 2 conditions" do
      post "/api/correlation_rules",
           params: {
             correlation_rule: valid_params[:correlation_rule].merge(
               conditions: {
                 operator: "AND",
                 conditions: [
                   { signal_type: "seismic_event", proximity_km: 50 },
                   { operator: "OR", conditions: [] }
                 ]
               }
             )
           },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].join(" ")).to include("compound conditions must contain at least 2 condition objects")
    end

    it "accepts valid nested compound conditions" do
      post "/api/correlation_rules",
           params: {
             correlation_rule: valid_params[:correlation_rule].merge(
               conditions: {
                 operator: "AND",
                 conditions: [
                   { signal_type: "seismic_event", proximity_km: 50 },
                   {
                     operator: "OR",
                     conditions: [
                       { signal_type: "ais_gap",     proximity_km: 100 },
                       { signal_type: "gps_jamming", proximity_km: 100 }
                     ]
                   }
                 ]
               }
             )
           },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:created)
    end

    it "accepts and persists area_of_operation_id" do
      ao = create(:area_of_operation)
      post "/api/correlation_rules",
           params:  { correlation_rule: valid_params[:correlation_rule].merge(area_of_operation_id: ao.id) },
           headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["area_of_operation_id"]).to eq(ao.id)
    end

    it "persists and returns mitre_tags" do
      params_with_tags = valid_params.deep_merge(
        correlation_rule: { mitre_tags: %w[T1562 T0826] }
      )
      post "/api/correlation_rules", params: params_with_tags,
           headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["mitre_tags"]).to contain_exactly("T1562", "T0826")
    end

    it "includes an empty mitre_tags array when none supplied" do
      post "/api/correlation_rules", params: valid_params,
           headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["mitre_tags"]).to eq([])
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

    it "writes an audit event with before/after snapshots on update" do
      expect {
        patch "/api/correlation_rules/#{rule_active.id}",
              params:  { correlation_rule: { name: "Renamed", is_active: false } },
              headers: auth_headers(commander), as: :json
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("correlation_rule.updated")
      expect(event.before_snapshot).to include(
        "name" => rule_active.name,
        "is_active" => true,
        "conditions" => rule_active.conditions.deep_stringify_keys,
        "actions" => rule_active.actions.deep_stringify_keys,
      )
      expect(event.after_snapshot).to include(
        "name" => "Renamed",
        "is_active" => false,
      )
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

    it "updates mitre_tags" do
      patch "/api/correlation_rules/#{rule_active.id}",
            params:  { correlation_rule: { mitre_tags: %w[T0879 T0880] } },
            headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["mitre_tags"]).to contain_exactly("T0879", "T0880")
    end
  end

  describe "DELETE /api/correlation_rules/:id" do
    it "returns 204 and destroys the rule for commanders" do
      expect {
        delete "/api/correlation_rules/#{rule_inactive.id}", headers: auth_headers(commander)
      }.to change(CorrelationRule, :count).by(-1)
      expect(response).to have_http_status(:no_content)
    end

    it "writes an audit event on destroy" do
      doomed_rule = create(:correlation_rule, :inactive, created_by: commander)

      expect {
        delete "/api/correlation_rules/#{doomed_rule.id}", headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("correlation_rule.deleted")
      expect(event.before_snapshot).to include(
        "name" => doomed_rule.name,
        "is_active" => false,
      )
      expect(event.after_snapshot).to include(
        "name" => doomed_rule.name,
        "deleted" => true,
      )
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

  describe "GET /api/correlation_rules/effectiveness" do
    let(:site)   { create(:site) }
    let(:signal) { create(:external_signal, lat: site.latitude, lng: site.longitude) }

    before do
      # One match for the active rule so the stat has non-zero data
      create(:signal_rule_match, correlation_rule: rule_active, site: site)
    end

    it "returns 200 with a hash keyed by rule_id" do
      get "/api/correlation_rules/effectiveness", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to be_a(Hash)
    end

    it "includes an entry for each rule" do
      get "/api/correlation_rules/effectiveness", headers: auth_headers(commander)
      body = JSON.parse(response.body)
      expect(body.keys).to include(rule_active.id)
    end

    it "is accessible to operators (no commander restriction)" do
      get "/api/correlation_rules/effectiveness", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
    end

    it "returns 401 for unauthenticated requests" do
      get "/api/correlation_rules/effectiveness"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/correlation_rules/:id/dry_run" do
    it "preserves legacy site-specific targeting for an inactive site" do
      site = create(:site, name: "Dormant Site", latitude: 51.5, longitude: 0.0, status: "inactive")
      signal = create(:external_signal,
                      signal_type: "seismic_event",
                      lat: 51.5,
                      lng: 0.0,
                      occurred_at: 5.minutes.ago)
      rule = create(:correlation_rule,
                    created_by: commander,
                    conditions: {
                      "site_id" => site.id,
                      "signal_type" => "seismic_event",
                      "proximity_km" => 0,
                    })

      post "/api/correlation_rules/#{rule.id}/dry_run",
           params: { hours: 1 },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["total_matches"]).to eq(1)
      expect(body["matches"]).to include(
        a_hash_including(
          "signal_id" => signal.id,
          "site_id" => site.id,
          "site_name" => site.name,
        ),
      )
    end

    it "mirrors evaluator corroboration for compound rules using the candidate signal time window" do
      travel_to(Time.zone.parse("2026-03-26 12:00:00 UTC")) do
        site = create(:site, name: "Fusion Site", latitude: 51.5, longitude: 0.0, status: "active")
        corroborating_signal = create(:external_signal,
                                      signal_type: "gps_jamming",
                                      source: "gpsjam",
                                      lat: 51.5,
                                      lng: 0.05,
                                      occurred_at: 150.minutes.ago)
        triggering_signal = create(:external_signal,
                                   signal_type: "ais_gap",
                                   source: "derived",
                                   lat: 51.5,
                                   lng: 0.1,
                                   occurred_at: 2.hours.ago)
        rule = create(:correlation_rule,
                      created_by: commander,
                      conditions: {
                        "operator" => "AND",
                        "conditions" => [
                          { "signal_type" => "ais_gap", "proximity_km" => 50, "time_window_minutes" => 60 },
                          { "signal_type" => "gps_jamming", "proximity_km" => 50, "time_window_minutes" => 60 },
                        ],
                      })

        post "/api/correlation_rules/#{rule.id}/dry_run",
             params: { hours: 4 },
             headers: auth_headers(commander), as: :json

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["total_matches"]).to eq(1)
        expect(body["matches"]).to contain_exactly(
          a_hash_including(
            "signal_id" => triggering_signal.id,
            "signal_type" => triggering_signal.signal_type,
            "site_id" => site.id,
            "site_name" => site.name,
          ),
        )
        expect(body["matches"].first["signal_id"]).not_to eq(corroborating_signal.id)
      end
    end

    it "requires enough corroborating signals when a compound condition has count_threshold greater than one" do
      travel_to(Time.zone.parse("2026-03-26 12:00:00 UTC")) do
        site = create(:site, name: "Fusion Site", latitude: 51.5, longitude: 0.0, status: "active")
        create(:external_signal,
               signal_type: "gps_jamming",
               source: "gpsjam",
               lat: 51.5,
               lng: 0.02,
               occurred_at: 150.minutes.ago)
        create(:external_signal,
               signal_type: "gps_jamming",
               source: "gpsjam",
               lat: 51.5,
               lng: 0.04,
               occurred_at: 130.minutes.ago)
        create(:external_signal,
               signal_type: "gps_jamming",
               source: "gpsjam",
               lat: 51.5,
               lng: 0.03,
               occurred_at: 190.minutes.ago)
        triggering_signal = create(:external_signal,
                                   signal_type: "ais_gap",
                                   source: "derived",
                                   lat: 51.5,
                                   lng: 0.1,
                                   occurred_at: 2.hours.ago)
        rule = create(:correlation_rule,
                      created_by: commander,
                      conditions: {
                        "operator" => "AND",
                        "conditions" => [
                          { "signal_type" => "ais_gap", "proximity_km" => 50, "time_window_minutes" => 60 },
                          {
                            "signal_type" => "gps_jamming",
                            "proximity_km" => 50,
                            "time_window_minutes" => 60,
                            "count_threshold" => 2,
                          },
                        ],
                      })

        post "/api/correlation_rules/#{rule.id}/dry_run",
             params: { hours: 4 },
             headers: auth_headers(commander), as: :json

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["total_matches"]).to eq(1)
        expect(body["matches"]).to contain_exactly(
          a_hash_including(
            "signal_id" => triggering_signal.id,
            "signal_type" => triggering_signal.signal_type,
            "site_id" => site.id,
            "site_name" => site.name,
          ),
        )
      end
    end

    it "does not report a compound dry-run hit when corroborating signals are absent" do
      site = create(:site, name: "Fusion Site", latitude: 51.5, longitude: 0.0, status: "active")
      create(:external_signal,
             signal_type: "ais_gap",
             source: "derived",
             lat: 51.5,
             lng: 0.1,
             occurred_at: 10.minutes.ago)
      rule = create(:correlation_rule,
                    created_by: commander,
                    conditions: {
                      "operator" => "AND",
                      "conditions" => [
                        { "signal_type" => "ais_gap", "proximity_km" => 50 },
                        { "signal_type" => "gps_jamming", "proximity_km" => 50 },
                      ],
                    })

      post "/api/correlation_rules/#{rule.id}/dry_run",
           params: { hours: 1 },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["total_matches"]).to eq(0)
      expect(body["matches"]).to eq([])
    end

    it "counts same-type history for untyped threshold rules" do
      travel_to(Time.zone.parse("2026-03-26 12:00:00 UTC")) do
        site = create(:site, name: "Threshold Site", latitude: 51.5, longitude: 0.0, status: "active")
        earlier_signal = create(:external_signal,
                                signal_type: "seismic_event",
                                source: "usgs_seismic",
                                lat: 51.5,
                                lng: 0.02,
                                occurred_at: 30.minutes.ago)
        later_signal = create(:external_signal,
                              signal_type: "seismic_event",
                              source: "usgs_seismic",
                              lat: 51.5,
                              lng: 0.03,
                              occurred_at: 10.minutes.ago)
        rule = create(:correlation_rule,
                      created_by: commander,
                      conditions: {
                        "proximity_km" => 50,
                        "count_threshold" => 2,
                        "time_window_minutes" => 60,
                      })

        post "/api/correlation_rules/#{rule.id}/dry_run",
             params: { hours: 1 },
             headers: auth_headers(commander), as: :json

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["total_matches"]).to eq(1)
        expect(body["matches"]).to contain_exactly(
          a_hash_including(
            "signal_id" => later_signal.id,
            "signal_type" => later_signal.signal_type,
            "site_id" => site.id,
            "site_name" => site.name,
          ),
        )
        expect(body["matches"].first["signal_id"]).not_to eq(earlier_signal.id)
      end
    end
  end
end
