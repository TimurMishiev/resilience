require 'rails_helper'

RSpec.describe "Api::Incidents::Prosecution", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:operator)  { create(:user) }
  let(:commander) { create(:user, :commander) }
  let(:viewer)    { create(:user, :viewer) }
  let!(:incident) { create(:incident) }

  describe "POST /api/incidents/:incident_id/prosecute" do
    it "requires authentication" do
      post "/api/incidents/#{incident.id}/prosecute"
      expect(response).to have_http_status(:unauthorized)
    end

    it "initiates prosecution as a commander" do
      post "/api/incidents/#{incident.id}/prosecute",
           params: { notes: "Escalating threat" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["prosecution_phase"]).to eq("assessing")
    end

    it "rejects operators" do
      post "/api/incidents/#{incident.id}/prosecute",
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "rejects viewers" do
      post "/api/incidents/#{incident.id}/prosecute",
           headers: auth_headers(viewer)

      expect(response).to have_http_status(:forbidden)
    end

    it "rejects double initiation" do
      incident.update!(prosecution_phase: "assessing", prosecuted_by: commander, prosecution_initiated_at: Time.current)

      post "/api/incidents/#{incident.id}/prosecute",
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/already being prosecuted/)
    end

    it "writes an audit event" do
      expect {
        post "/api/incidents/#{incident.id}/prosecute",
             headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("prosecution_started")
    end
  end

  describe "GET /api/incidents/:incident_id/prosecution_steps" do
    it "requires authentication" do
      get "/api/incidents/#{incident.id}/prosecution_steps"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns an empty array when no steps exist" do
      get "/api/incidents/#{incident.id}/prosecution_steps", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq([])
    end

    it "returns prosecution steps with serialized fields" do
      incident.update!(prosecution_phase: "assessing", prosecuted_by: commander, prosecution_initiated_at: Time.current)
      step = create(:prosecution_step, incident: incident, actor: commander, phase: "assessing", notes: "Initial assessment")

      get "/api/incidents/#{incident.id}/prosecution_steps", headers: auth_headers(operator)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.length).to eq(1)
      expect(json[0]["id"]).to eq(step.id)
      expect(json[0]["phase"]).to eq("assessing")
      expect(json[0]["notes"]).to eq("Initial assessment")
      expect(json[0]["actor"]["email"]).to eq(commander.email)
    end

    it "filters steps by as_of" do
      incident.update!(prosecution_phase: "executing", prosecuted_by: commander, prosecution_initiated_at: 2.hours.ago)
      create(:prosecution_step, incident: incident, actor: commander, phase: "assessing", occurred_at: 2.hours.ago)
      create(:prosecution_step, :executing, incident: incident, actor: commander, occurred_at: 30.minutes.ago)

      get "/api/incidents/#{incident.id}/prosecution_steps",
          params: { as_of: 1.hour.ago.iso8601 },
          headers: auth_headers(operator)

      json = JSON.parse(response.body)
      expect(json.length).to eq(1)
      expect(json[0]["phase"]).to eq("assessing")
    end

    it "allows viewers to list steps" do
      get "/api/incidents/#{incident.id}/prosecution_steps", headers: auth_headers(viewer)
      expect(response).to have_http_status(:ok)
    end
  end

  describe "POST /api/incidents/:incident_id/prosecution_steps" do
    before do
      incident.update!(prosecution_phase: "assessing", prosecuted_by: commander, prosecution_initiated_at: Time.current)
    end

    it "requires authentication" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "note_added" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "adds a step as a commander" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "note_added", notes: "Continuing assessment" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["phase"]).to eq("assessing")
      expect(json["action_type"]).to eq("note_added")
    end

    it "advances phase to executing" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "executing", action_type: "phase_transition" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:created)
      expect(incident.reload.prosecution_phase).to eq("executing")
    end

    it "rejects backward phase transitions" do
      incident.update!(prosecution_phase: "executing")

      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "phase_transition" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/Cannot set phase/)
    end

    it "rejects operators" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "note_added" },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end

    it "rejects evidence_linked steps without evidence refs" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "evidence_linked" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/evidence reference/)
    end

    it "accepts evidence_linked steps with valid refs" do
      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: {
             phase: "assessing",
             action_type: "evidence_linked",
             evidence_refs: { signal_ids: ["sig-1", "sig-2"] },
           },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["evidence_refs"]["signal_ids"]).to eq(["sig-1", "sig-2"])
    end

    it "rejects steps on non-prosecuted incidents" do
      incident.update!(prosecution_phase: nil, prosecuted_by: nil)

      post "/api/incidents/#{incident.id}/prosecution_steps",
           params: { phase: "assessing", action_type: "note_added" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/not being prosecuted/)
    end

    it "writes an audit event" do
      expect {
        post "/api/incidents/#{incident.id}/prosecution_steps",
             params: { phase: "assessing", action_type: "note_added" },
             headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("prosecution_step_added")
    end
  end
end
