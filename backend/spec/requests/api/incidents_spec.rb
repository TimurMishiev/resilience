require 'rails_helper'

RSpec.describe "Api::Incidents", type: :request do
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
    )
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

    it "returns 404 for unknown id" do
      get "/api/incidents/#{SecureRandom.uuid}", headers: auth_headers(operator)
      expect(response).to have_http_status(:not_found)
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
      expect(response).to have_http_status(:unprocessable_entity)
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
      expect(response).to have_http_status(:unprocessable_entity)
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

    it "allows operators to assign" do
      patch "/api/incidents/#{incident.id}/assign",
            params:  { assignee_id: operator.id },
            headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "filters index by assigned_to_id" do
      incident.update!(assigned_to_id: operator.id, assigned_at: Time.current)

      get "/api/incidents", params: { assigned_to_id: operator.id },
          headers: auth_headers(operator)

      ids = JSON.parse(response.body)["data"].map { |i| i["id"] }
      expect(ids).to include(incident.id)
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

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "writes an audit event" do
      expect {
        post "/api/incidents/#{incident.id}/notes",
             params:  { body: "Intel confirmed." },
             headers: auth_headers(operator), as: :json
      }.to change { AuditEvent.where(event_type: "note_added", entity_id: incident.id).count }.by(1)
    end
  end
end
