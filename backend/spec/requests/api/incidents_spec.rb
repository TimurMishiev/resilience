require 'rails_helper'

RSpec.describe "Api::Incidents", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:operator)   { create(:user) }
  let(:commander)  { create(:user, :commander) }
  let!(:site)      { create(:site) }
  let!(:incident)  do
    Incident.create!(
      title:     "Test incident",
      site:      site,
      status:    "open",
      severity:  "high",
      confidence: 0.75,
      opened_at: 2.hours.ago
    ).tap do |record|
      record.update_columns(created_at: 2.hours.ago, updated_at: 2.hours.ago)
    end
  end

  describe "GET /api/incidents" do
    it "requires authentication" do
      get "/api/incidents"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns paginated incidents" do
      get "/api/incidents", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"]).to be_an(Array)
      expect(json["data"].first["id"]).to eq incident.id
    end

    it "filters by status" do
      closed = Incident.create!(title: "Closed", status: "closed", severity: "low",
                                confidence: 0.2, opened_at: 1.hour.ago)
      get "/api/incidents", params: { status: "open" }, headers: auth_headers(operator)
      ids = JSON.parse(response.body)["data"].map { |i| i["id"] }
      expect(ids).to include(incident.id)
      expect(ids).not_to include(closed.id)
    end

    it "filters by severity" do
      get "/api/incidents", params: { severity: "high" }, headers: auth_headers(operator)
      expect(JSON.parse(response.body)["data"].map { |i| i["severity"] }).to all(eq("high"))
    end

    it "filters by site_id" do
      other_site = create(:site)
      other_incident = Incident.create!(title: "Other site", site: other_site,
                                        severity: "low", confidence: 0.1, opened_at: 1.hour.ago)
      get "/api/incidents", params: { site_id: other_site.id }, headers: auth_headers(operator)
      ids = JSON.parse(response.body)["data"].map { |i| i["id"] }
      expect(ids).to eq [other_incident.id]
    end

    it "includes alert_count and task_count" do
      get "/api/incidents", headers: auth_headers(operator)
      row = JSON.parse(response.body)["data"].first
      expect(row).to have_key("alert_count")
      expect(row).to have_key("task_count")
    end

    it "replays status and assignment as_of" do
      travel_to 30.minutes.ago do
        Incidents::TransitionService.call(incident: incident, to_status: "acknowledged", actor: commander)
      end
      travel_to 20.minutes.ago do
        Incidents::AssignService.call(incident: incident, assignee: commander, actor: commander)
      end

      get "/api/incidents",
          params: { as_of: 45.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      row = JSON.parse(response.body).fetch("data").first
      expect(row.fetch("status")).to eq("open")
      expect(row.fetch("assigned_to")).to be_nil
    end

    # QA F3 (2026-04-28): the prior serializer always returned the live
    # `updated_at`, even in replay. An operator scrubbing replay would
    # see a future "last updated" timestamp on an incident whose actual
    # state was correctly snapshotted to the historical cutoff —
    # cosmetic but misleading. Fix clamps `updated_at` to as_of when
    # the live timestamp is past the cutoff. Matches the precedent at
    # tasks_controller.rb#176 and correlation_rules_controller.rb#370.
    it "clamps updated_at to as_of during replay (QA F3)" do
      # The let-block creates incident at base_time = 1.hour.ago.
      # We mutate it AFTER as_of so the live updated_at is in the
      # operator's "future" relative to the replay window.
      travel_to 10.minutes.ago do
        Incidents::TransitionService.call(incident: incident, to_status: "acknowledged", actor: commander)
      end

      as_of_iso = 45.minutes.ago.iso8601
      as_of_ts  = Time.iso8601(as_of_iso)

      get "/api/incidents",
          params: { as_of: as_of_iso },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      row = JSON.parse(response.body).fetch("data").first
      returned_updated_at = Time.iso8601(row.fetch("updated_at"))

      # Critical assertion: updated_at must NOT be in the operator's
      # "future" relative to as_of. Pre-fix it would be ~10 minutes
      # ago (the live mutation time), which is past as_of (45m ago).
      expect(returned_updated_at).to be <= as_of_ts
      # And the actual replay state must still be the historical
      # value, proving the clamp didn't break the snapshot logic.
      expect(row.fetch("status")).to eq("open")
    end

    it "preserves untouched fields when future partial audit events exist" do
      create(:audit_event,
        actor: "system",
        entity_type: "Incident",
        entity_id: incident.id,
        event_type: "note_added",
        action: "note",
        before_snapshot: {},
        after_snapshot: {
          note_id: SecureRandom.uuid,
          body_preview: "Later note",
        },
        occurred_at: 15.minutes.ago,
        correlation_id: SecureRandom.uuid,
      )

      get "/api/incidents",
          params: { as_of: 45.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      row = JSON.parse(response.body).fetch("data").first
      expect(row.fetch("title")).to eq("Test incident")
      expect(row.fetch("severity")).to eq("high")
    end
  end

  describe "GET /api/incidents/:id" do
    it "returns incident with nested alerts and tasks" do
      get "/api/incidents/#{incident.id}", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq incident.id
      expect(json).to have_key("alerts")
      expect(json).to have_key("tasks")
    end

    it "returns chain-ready alert evidence fields in the detailed response" do
      match = create(:signal_rule_match, incident: incident, site: site)
      match.update!(
        workflow_status: "acknowledged",
        acknowledged_at: 10.minutes.ago,
        acknowledged_by: commander,
        notes: "Operator reviewed the breach",
      )

      get "/api/incidents/#{incident.id}", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      alert = JSON.parse(response.body).fetch("alerts").find { |row| row.fetch("id") == match.id }
      expect(alert.fetch("metadata")).to include("distance_km" => 42.5)
      expect(alert.dig("site", "id")).to eq(site.id)
      expect(alert.dig("task", "id")).to eq(match.task.id)
      expect(alert.dig("acknowledged_by", "id")).to eq(commander.id)
      expect(alert.fetch("notes")).to eq("Operator reviewed the breach")
    end

    it "deduplicates shared tasks in the detailed response while preserving match order" do
      shared_task = create(:task, site: site, title: "Shared task")
      trailing_task = create(:task, site: site, title: "Trailing task")

      create(:signal_rule_match, :without_task, incident: incident, site: site, task: shared_task)
      create(:signal_rule_match, :without_task, incident: incident, site: site, task: shared_task)
      create(:signal_rule_match, :without_task, incident: incident, site: site, task: trailing_task)

      get "/api/incidents/#{incident.id}", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      tasks = JSON.parse(response.body).fetch("tasks")
      expect(tasks.map { |task| task.fetch("id") }).to eq([shared_task.id, trailing_task.id])
    end

    it "returns 404 for unknown id" do
      get "/api/incidents/#{SecureRandom.uuid}", headers: auth_headers(operator)
      expect(response).to have_http_status(:not_found)
    end

    it "replays alert workflow state and excludes future tasks as_of" do
      task = create(:task, site: site, title: "Future task")
      match = create(:signal_rule_match, incident: incident, site: site, task: task, fired_at: 2.hours.ago)

      travel_to 30.minutes.ago do
        Alerts::TransitionService.call(
          match: match,
          to_status: "acknowledged",
          actor: commander,
          notes: "Handled later",
        )
      end

      create(:audit_event,
        actor: "system",
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: task.attributes.except("updated_at"),
        occurred_at: 15.minutes.ago,
        correlation_id: SecureRandom.uuid,
      )

      get "/api/incidents/#{incident.id}",
          params: { as_of: 45.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("alert_count")).to eq(1)
      expect(body.fetch("task_count")).to eq(0)
      alert = body.fetch("alerts").first
      expect(alert.fetch("workflow_status")).to eq("unacknowledged")
      expect(alert.fetch("acknowledged_at")).to be_nil
      expect(alert.fetch("acknowledged_by")).to be_nil
      expect(alert.fetch("notes")).to be_nil
      expect(alert.fetch("task")).to be_nil
      expect(body.fetch("tasks")).to eq([])
    end

    it "replays historical site, AO, and rule context as_of" do
      area = create(:area_of_operation, name: "Gulf AO", posture: "observe")
      site.update!(name: "Port Alpha", area_of_operation: area)
      incident.update!(area_of_operation: area)
      rule = create(:correlation_rule, name: "Perimeter Watch")
      create(:signal_rule_match, :without_task, incident: incident, site: site, correlation_rule: rule, fired_at: 2.hours.ago)

      create(:audit_event,
        actor: "system",
        entity_type: "Site",
        entity_id: site.id,
        event_type: "site.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: {
          name: "Port Alpha",
          area_of_operation_id: area.id,
        },
        occurred_at: 2.hours.ago,
        correlation_id: SecureRandom.uuid,
      )
      create(:audit_event,
        actor: "system",
        entity_type: "AreaOfOperation",
        entity_id: area.id,
        event_type: "area_of_operation_created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: {
          name: "Gulf AO",
          posture: "observe",
        },
        occurred_at: 2.hours.ago,
        correlation_id: SecureRandom.uuid,
      )
      create(:audit_event,
        actor: "system",
        entity_type: "CorrelationRule",
        entity_id: rule.id,
        event_type: "correlation_rule.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: {
          name: "Perimeter Watch",
        },
        occurred_at: 2.hours.ago,
        correlation_id: SecureRandom.uuid,
      )

      travel_to 20.minutes.ago do
        site.update!(name: "Port Zeta")
        area.update!(name: "Renamed AO", posture: "weapons_free")
        rule.update!(name: "Renamed Rule")

        create(:audit_event,
          actor: "system",
          entity_type: "Site",
          entity_id: site.id,
          event_type: "site.updated",
          action: "update",
          before_snapshot: {
            name: "Port Alpha",
            area_of_operation_id: area.id,
          },
          after_snapshot: {
            name: "Port Zeta",
            area_of_operation_id: area.id,
          },
          occurred_at: Time.current,
          correlation_id: SecureRandom.uuid,
        )
        create(:audit_event,
          actor: "system",
          entity_type: "AreaOfOperation",
          entity_id: area.id,
          event_type: "area_of_operation_updated",
          action: "update",
          before_snapshot: {
            name: "Gulf AO",
            posture: "observe",
          },
          after_snapshot: {
            name: "Renamed AO",
            posture: "weapons_free",
          },
          occurred_at: Time.current,
          correlation_id: SecureRandom.uuid,
        )
        create(:audit_event,
          actor: "system",
          entity_type: "CorrelationRule",
          entity_id: rule.id,
          event_type: "correlation_rule.updated",
          action: "update",
          before_snapshot: {
            name: "Perimeter Watch",
          },
          after_snapshot: {
            name: "Renamed Rule",
          },
          occurred_at: Time.current,
          correlation_id: SecureRandom.uuid,
        )
      end

      get "/api/incidents/#{incident.id}",
          params: { as_of: 45.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.dig("site", "name")).to eq("Port Alpha")
      expect(body.dig("area_of_operation", "name")).to eq("Gulf AO")
      expect(body.dig("area_of_operation", "posture")).to eq("observe")
      expect(body.fetch("alerts").first.dig("correlation_rule", "name")).to eq("Perimeter Watch")
    end
  end

  describe "PATCH /api/incidents/:id" do
    it "allows operator to update title and description" do
      patch "/api/incidents/#{incident.id}",
            params: { incident: { title: "Updated", description: "Some detail" } },
            headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["title"]).to eq "Updated"
    end

    it "returns 422 for blank title" do
      patch "/api/incidents/#{incident.id}",
            params: { incident: { title: "" } },
            headers: auth_headers(operator)
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "POST /api/incidents/:id/transition" do
    it "transitions open → acknowledged" do
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "acknowledged" },
           headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq "acknowledged"
    end

    it "sets acknowledged_at when transitioning to acknowledged" do
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "acknowledged" },
           headers: auth_headers(operator)
      expect(JSON.parse(response.body)["acknowledged_at"]).not_to be_nil
    end

    it "transitions open → contained (valid)" do
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "contained" },
           headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq "contained"
    end

    it "returns 422 when transitioning to an invalid next status" do
      incident.update!(status: "closed")
      post "/api/incidents/#{incident.id}/transition",
           params: { to_status: "acknowledged" },
           headers: auth_headers(operator)
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /api/incidents/:id/allowed_transitions" do
    it "returns allowed transitions for current status" do
      get "/api/incidents/#{incident.id}/allowed_transitions",
          headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      allowed = JSON.parse(response.body)["allowed"]
      expect(allowed).to include("acknowledged")
    end
  end

  describe "PATCH /api/incidents/:id/assign" do
    it "assigns the incident to a user and returns assigned_to in response" do
      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: operator.id },
            headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["assigned_to"]["id"]).to eq operator.id
      expect(body["assigned_at"]).not_to be_nil
    end

    it "unassigns when assignee_id is absent" do
      incident.update!(assigned_to_id: operator.id, assigned_at: Time.current)

      patch "/api/incidents/#{incident.id}/assign",
            params:  {},
            headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["assigned_to"]).to be_nil
    end

    it "returns 404 when assignee_id does not match a user" do
      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: SecureRandom.uuid },
            headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 when commander tries to assign a user from another organization" do
      org_a = create(:organization)
      org_b = create(:organization)
      site.update!(organization: org_a)
      commander.update!(organization: org_a)
      foreign_user = create(:user, organization: org_b)

      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: foreign_user.id },
            headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:not_found)
      expect(incident.reload.assigned_to).to be_nil
    end

    it "returns 404 when commander tries to assign a user scoped to a different AO" do
      org = create(:organization)
      ao_a = create(:area_of_operation, organization: org, created_by: commander)
      ao_b = create(:area_of_operation, organization: org, created_by: commander)
      site.update!(organization: org, area_of_operation: ao_a)
      incident.update!(area_of_operation: ao_a)
      commander.update!(organization: org)
      foreign_ao_user = create(:user, organization: org, area_of_operation: ao_b)

      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: foreign_ao_user.id },
            headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:not_found)
      expect(incident.reload.assigned_to).to be_nil
    end

    it "allows operators to self-assign" do
      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: operator.id },
            headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "returns 403 when operator tries to take an incident already assigned to another user" do
      other = create(:user)
      incident.update!(assigned_to_id: other.id, assigned_at: Time.current)

      expect {
        patch "/api/incidents/#{incident.id}/assign",
              params:  { assignee_id: operator.id },
              headers: auth_headers(operator), as: :json
      }.to change {
        AuditEvent.where(event_type: "incident_assignment_forbidden", entity_id: incident.id).count
      }.by(1)

      expect(response).to have_http_status(:forbidden)
      event = AuditEvent.order(:occurred_at).last
      expect(event.metadata).to include(
        "attempted_assignee_id" => operator.id,
        "actor_role" => "operator",
      )
    end

    it "returns 403 when operator tries to assign to a different user" do
      other = create(:user)
      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: other.id },
            headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "allows operator to release their own assignment" do
      incident.update!(assigned_to_id: operator.id, assigned_at: Time.current)

      patch "/api/incidents/#{incident.id}/assign",
            params:  {},
            headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["assigned_to"]).to be_nil
    end

    it "returns 403 when operator tries to clear another user's assignment" do
      other = create(:user)
      incident.update!(assigned_to_id: other.id, assigned_at: Time.current)

      expect {
        patch "/api/incidents/#{incident.id}/assign",
              params:  {},
              headers: auth_headers(operator), as: :json
      }.to change {
        AuditEvent.where(event_type: "incident_assignment_forbidden", entity_id: incident.id).count
      }.by(1)

      expect(response).to have_http_status(:forbidden)
      event = AuditEvent.order(:occurred_at).last
      expect(event.metadata).to include(
        "attempted_assignee_id" => nil,
        "actor_role" => "operator",
      )
    end

    it "filters index by assigned_to_id" do
      incident.update!(assigned_to_id: operator.id, assigned_at: Time.current)

      get "/api/incidents", params: { assigned_to_id: operator.id },
          headers: auth_headers(operator)

      ids = JSON.parse(response.body)["data"].map { |i| i["id"] }
      expect(ids).to include(incident.id)
    end
  end

  describe "GET /api/incidents/:id/chain" do
    it "requires authentication" do
      get "/api/incidents/#{incident.id}/chain"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns nodes and edges for an incident with no matches" do
      get "/api/incidents/#{incident.id}/chain", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to have_key("nodes")
      expect(body).to have_key("edges")

      # Only the incident node itself
      expect(body["nodes"].length).to eq 1
      expect(body["nodes"].first["type"]).to eq "incident"
      expect(body["nodes"].first["id"]).to eq incident.id
      expect(body["edges"]).to be_empty
    end

    it "includes signal, rule, alert, and task nodes for a linked match" do
      match = create(:signal_rule_match, site: site)
      incident.signal_rule_matches << match

      get "/api/incidents/#{incident.id}/chain", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body  = JSON.parse(response.body)
      types = body["nodes"].map { |n| n["type"] }

      expect(types).to include("incident", "alert", "signal", "rule", "task")
    end

    it "deduplicates shared signal nodes across multiple alerts" do
      signal = create(:external_signal)
      rule1  = create(:correlation_rule)
      rule2  = create(:correlation_rule)
      match1 = create(:signal_rule_match, :without_task, signal: signal, correlation_rule: rule1, site: site)
      match2 = create(:signal_rule_match, :without_task, signal: signal, correlation_rule: rule2, site: site)
      incident.signal_rule_matches << match1
      incident.signal_rule_matches << match2

      get "/api/incidents/#{incident.id}/chain", headers: auth_headers(operator)

      body         = JSON.parse(response.body)
      signal_nodes = body["nodes"].select { |n| n["type"] == "signal" }
      rule_nodes   = body["nodes"].select { |n| n["type"] == "rule"   }

      expect(signal_nodes.length).to eq 1
      expect(rule_nodes.length).to  eq 2
    end

    it "returns 404 for a non-existent incident" do
      get "/api/incidents/00000000-0000-0000-0000-000000000000/chain",
          headers: auth_headers(operator)
      expect(response).to have_http_status(:not_found)
    end

    it "clips chain nodes to the replay timestamp" do
      task = create(:task, site: site, title: "Future task")
      match = create(:signal_rule_match, incident: incident, site: site, task: task, fired_at: 2.hours.ago)

      travel_to 30.minutes.ago do
        Alerts::TransitionService.call(
          match: match,
          to_status: "acknowledged",
          actor: commander,
          notes: "Handled later",
        )
      end

      create(:audit_event,
        actor: "system",
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: task.attributes.except("updated_at"),
        occurred_at: 15.minutes.ago,
        correlation_id: SecureRandom.uuid,
      )

      get "/api/incidents/#{incident.id}/chain",
          params: { as_of: 45.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("nodes").map { |node| node.fetch("type") }).not_to include("task")
      alert_node = body.fetch("nodes").find { |node| node.fetch("type") == "alert" }
      expect(alert_node.dig("data", "status")).to eq("unacknowledged")
    end

    it "returns meta.truncated false for small chains" do
      get "/api/incidents/#{incident.id}/chain", headers: auth_headers(operator)

      body = JSON.parse(response.body)
      expect(body["meta"]["truncated"]).to eq false
      expect(body["meta"]["node_count"]).to eq 1
    end

    it "caps nodes at 200 and sets meta.truncated true" do
      # Create enough matches to exceed 200 nodes (each match adds up to 4 nodes: signal, rule, alert, task)
      51.times do
        match = create(:signal_rule_match, site: site)
        incident.signal_rule_matches << match
      end

      get "/api/incidents/#{incident.id}/chain", headers: auth_headers(operator)

      body = JSON.parse(response.body)
      expect(body["meta"]["truncated"]).to eq true
      # Cap is checked per-match; one batch of sub-nodes may push slightly past 200
      expect(body["nodes"].size).to be < 210
    end
  end

  describe "GET /api/incidents/:id/notes" do
    let!(:note) { create(:incident_note, incident: incident, author: operator, body: "Situation developing.") }

    it "returns notes in chronological order" do
      get "/api/incidents/#{incident.id}/notes", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to be_an(Array)
      expect(body.first["body"]).to eq "Situation developing."
      expect(body.first["author"]["id"]).to eq operator.id
    end

    it "returns empty array when no notes exist" do
      empty = Incident.create!(title: "Empty", severity: "low", confidence: 0.1, opened_at: Time.current)
      get "/api/incidents/#{empty.id}/notes", headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq []
    end
  end

  describe "POST /api/incidents/:id/notes" do
    it "creates a note and returns 201" do
      post "/api/incidents/#{incident.id}/notes",
           params:  { body: "Aircraft vector confirmed northeast." },
           headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["body"]).to eq "Aircraft vector confirmed northeast."
      expect(body["author"]["id"]).to eq operator.id
    end

    it "returns 422 for blank body" do
      post "/api/incidents/#{incident.id}/notes",
           params:  { body: "   " },
           headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "writes an audit event" do
      expect {
        post "/api/incidents/#{incident.id}/notes",
             params:  { body: "Intel confirmed." },
             headers: auth_headers(operator), as: :json
      }.to change { AuditEvent.where(event_type: "note_added", entity_id: incident.id).count }.by(1)
    end
  end

  describe "POST /api/incidents/:id/prosecute" do
    it "requires commander role" do
      post "/api/incidents/#{incident.id}/prosecute",
           params: { notes: "Begin prosecution" },
           headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "initiates prosecution and returns serialized incident prosecution fields" do
      post "/api/incidents/#{incident.id}/prosecute",
           params: { notes: "Begin prosecution" },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["prosecution_phase"]).to eq("assessing")
      expect(body.dig("prosecuted_by", "id")).to eq(commander.id)
      expect(body["prosecution_initiated_at"]).not_to be_nil
    end
  end

  describe "GET /api/incidents/:id/prosecution_steps" do
    it "is visible to authenticated operators and returns steps oldest-first" do
      incident.update!(
        prosecution_phase: "assessing",
        prosecuted_by: commander,
        prosecution_initiated_at: 15.minutes.ago
      )
      older = create(:prosecution_step, incident: incident, actor: commander, occurred_at: 10.minutes.ago, created_at: 10.minutes.ago)
      newer = create(:prosecution_step, incident: incident, actor: commander, occurred_at: 5.minutes.ago, created_at: 5.minutes.ago)

      get "/api/incidents/#{incident.id}/prosecution_steps",
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.map { |step| step["id"] }).to eq([older.id, newer.id])
    end

    it "clips prosecution steps to the replay timestamp" do
      incident.update!(
        prosecution_phase: "assessing",
        prosecuted_by: commander,
        prosecution_initiated_at: 15.minutes.ago
      )
      older = create(:prosecution_step, incident: incident, actor: commander, occurred_at: 10.minutes.ago, created_at: 10.minutes.ago)
      create(:prosecution_step, incident: incident, actor: commander, occurred_at: 5.minutes.ago, created_at: 5.minutes.ago)

      get "/api/incidents/#{incident.id}/prosecution_steps",
          params: { as_of: 7.minutes.ago.iso8601 },
          headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.map { |step| step["id"] }).to eq([older.id])
    end
  end

  describe "POST /api/incidents/:id/prosecution_steps" do
    before do
      Incidents::ProsecutionService.call(
        operation: :initiate,
        incident: incident,
        actor: commander,
      )
    end

    it "requires commander role" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: {
             phase: "assessing",
             action_type: "note_added",
             notes: "Operator should not be able to add this",
           },
           headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "filters unknown evidence_refs keys before persisting" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: {
             phase: "assessing",
             action_type: "evidence_linked",
             evidence_refs: {
               signal_ids: ["sig-1", "sig-2"],
               rogue_key: ["drop-me"],
             },
           },
           headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["evidence_refs"]).to eq({ "signal_ids" => ["sig-1", "sig-2"] })
      expect(ProsecutionStep.order(:created_at).last.evidence_refs).to eq({ "signal_ids" => ["sig-1", "sig-2"] })
    end
  end
end
