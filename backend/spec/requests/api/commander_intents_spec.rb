require "rails_helper"

RSpec.describe "Api::CommanderIntents", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator) { create(:user, :operator) }
  let(:ao) { create(:area_of_operation, name: "North Gulf") }

  describe "POST /api/commander_intents" do
    let(:valid_params) do
      {
        commander_intent: {
          area_of_operation_id: ao.id,
          title: "Protect northern corridor",
          objective: "Sustain ISR over the approach lanes.",
          end_state: "Friendly sites retain uninterrupted awareness over the AO.",
          constraints: "Avoid visible escalation near civilian traffic.",
        }
      }
    end

    it "creates a commander intent and writes an audit event" do
      expect {
        post "/api/commander_intents", params: valid_params, headers: auth_headers(commander)
      }.to change(CommanderIntent, :count).by(1).and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["area_of_operation_id"]).to eq(ao.id)
      expect(body["title"]).to eq("Protect northern corridor")
      expect(AuditEvent.last.event_type).to eq("commander_intent.created")
    end

    it "forbids operators" do
      post "/api/commander_intents", params: valid_params, headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/commander_intents/:id" do
    let!(:intent) { create(:commander_intent, area_of_operation: ao) }

    it "updates the intent and writes an audit event" do
      original_end_state = intent.end_state

      patch "/api/commander_intents/#{intent.id}",
            params: { commander_intent: { end_state: "Coverage gaps are closed before dawn." } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["end_state"]).to eq("Coverage gaps are closed before dawn.")
      expect(AuditEvent.last.event_type).to eq("commander_intent.updated")
      expect(AuditEvent.last.before_snapshot["end_state"]).to eq(original_end_state)
    end

    it "rejects area_of_operation_id reassignment on update" do
      other_ao = create(:area_of_operation, name: "Southern Arc")

      patch "/api/commander_intents/#{intent.id}",
            params: { commander_intent: { area_of_operation_id: other_ao.id, title: "Updated title" } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to include("area_of_operation_id cannot be changed")
      expect(intent.reload.area_of_operation_id).to eq(ao.id)
    end
  end
end
