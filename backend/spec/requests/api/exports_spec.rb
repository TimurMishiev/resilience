require "rails_helper"

RSpec.describe "Api::Exports", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:signal_old) { create(:external_signal, occurred_at: 3.days.ago) }
  let!(:signal_new) { create(:external_signal, occurred_at: 1.hour.ago) }

  describe "POST /api/exports" do
    it "returns CSV for signals" do
      post "/api/exports",
           params: { entity_type: "signals", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("text/csv")

      lines = response.body.lines
      expect(lines.first).to include("ID")
      expect(lines.first).to include("Source")
      expect(lines.size).to eq(3) # header + 2 records
    end

    it "returns JSON for signals" do
      post "/api/exports",
           params: { entity_type: "signals", format: "json" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("application/json")

      body = JSON.parse(response.body)
      expect(body["entity_type"]).to eq("signals")
      expect(body["count"]).to eq(2)
      expect(body["records"]).to be_an(Array)
      expect(body["records"].size).to eq(2)
    end

    it "filters by time range" do
      post "/api/exports",
           params: {
             entity_type: "signals",
             format: "csv",
             from: 2.hours.ago.iso8601,
             to: Time.current.iso8601,
           },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      lines = response.body.lines
      expect(lines.size).to eq(2) # header + 1 recent signal
    end

    it "writes an audit event" do
      expect {
        post "/api/exports",
             params: { entity_type: "signals", format: "csv" },
             headers: auth_headers(commander)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("data_exported")
      expect(event.after_snapshot["entity_type"]).to eq("signals")
      expect(event.after_snapshot["format"]).to eq("csv")
    end

    it "supports sites export" do
      create(:site, name: "Forward Base")
      post "/api/exports",
           params: { entity_type: "sites", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("Forward Base")
    end

    it "supports incidents export" do
      post "/api/exports",
           params: { entity_type: "incidents", format: "json" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["entity_type"]).to eq("incidents")
    end

    it "supports tasks export" do
      post "/api/exports",
           params: { entity_type: "tasks", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("text/csv")
    end

    it "supports audit_events export" do
      post "/api/exports",
           params: { entity_type: "audit_events", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("text/csv")
    end

    it "returns 400 for unknown entity type" do
      post "/api/exports",
           params: { entity_type: "widgets", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:bad_request)
    end

    it "returns 422 for invalid format" do
      post "/api/exports",
           params: { entity_type: "signals", format: "xml" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 403 for operator" do
      post "/api/exports",
           params: { entity_type: "signals", format: "csv" },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end
end
