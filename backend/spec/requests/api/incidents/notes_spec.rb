require 'rails_helper'

RSpec.describe "Api::Incidents::Notes", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:operator)  { create(:user) }
  let(:commander) { create(:user, :commander) }
  let(:viewer)    { create(:user, :viewer) }
  let!(:incident) { create(:incident) }

  describe "GET /api/incidents/:incident_id/notes" do
    it "requires authentication" do
      get "/api/incidents/#{incident.id}/notes"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns an empty array when no notes exist" do
      get "/api/incidents/#{incident.id}/notes", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq([])
    end

    it "returns notes in chronological order" do
      note1 = create(:incident_note, incident: incident, author: operator, body: "First note")
      note2 = nil
      travel_to 5.minutes.from_now do
        note2 = create(:incident_note, incident: incident, author: commander, body: "Second note")
      end

      get "/api/incidents/#{incident.id}/notes", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.length).to eq(2)
      expect(json[0]["id"]).to eq(note1.id)
      expect(json[1]["id"]).to eq(note2.id)
      expect(json[0]["body"]).to eq("First note")
      expect(json[0]["author"]["email"]).to eq(operator.email)
    end

    it "filters notes by as_of" do
      create(:incident_note, incident: incident, author: operator, body: "Old note")
      travel_to 1.hour.from_now do
        create(:incident_note, incident: incident, author: operator, body: "New note")
      end

      get "/api/incidents/#{incident.id}/notes",
          params: { as_of: 30.minutes.from_now.iso8601 },
          headers: auth_headers(operator)

      json = JSON.parse(response.body)
      expect(json.length).to eq(1)
      expect(json[0]["body"]).to eq("Old note")
    end

    it "allows viewers to list notes" do
      create(:incident_note, incident: incident, author: operator, body: "Visible to viewer")
      get "/api/incidents/#{incident.id}/notes", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).length).to eq(1)
    end
  end

  describe "POST /api/incidents/:incident_id/notes" do
    it "requires authentication" do
      post "/api/incidents/#{incident.id}/notes", params: { body: "Test" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "creates a note as an operator" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "Operator observation" },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["body"]).to eq("Operator observation")
      expect(json["author"]["id"]).to eq(operator.id)
    end

    it "creates a note as a commander" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "Commander directive" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:created)
    end

    it "rejects blank body" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "   " },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to include("Note body cannot be blank")
    end

    it "rejects body exceeding max length" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "x" * (IncidentNote::MAX_BODY_LENGTH + 1) },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects viewers" do
      post "/api/incidents/#{incident.id}/notes",
           params: { body: "Viewer attempt" },
           headers: auth_headers(viewer)

      expect(response).to have_http_status(:forbidden)
    end

    it "writes an audit event" do
      expect {
        post "/api/incidents/#{incident.id}/notes",
             params: { body: "Audited note" },
             headers: auth_headers(operator)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("note_added")
      expect(event.entity_id).to eq(incident.id)
    end
  end
end
