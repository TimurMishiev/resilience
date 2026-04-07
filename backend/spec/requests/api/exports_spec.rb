require "rails_helper"

RSpec.describe "Api::Exports", type: :request do
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }
  let(:viewer)    { create(:user, role: "viewer") }

  let!(:signal_old) { create(:external_signal, occurred_at: 3.days.ago, source: "usgs_seismic", signal_type: "seismic_event") }
  let!(:signal_new) { create(:external_signal, occurred_at: 1.hour.ago, source: "ais", signal_type: "vessel_position") }

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

    it "supports signal_rule_matches export" do
      create(:signal_rule_match)
      post "/api/exports",
           params: { entity_type: "signal_rule_matches", format: "csv" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("text/csv")
      lines = response.body.lines
      expect(lines.first).to include("FiredAt")
      expect(lines.first).to include("Confidence")
      expect(lines.size).to eq(2) # header + 1 record
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

    # ── Role access ──────────────────────────────────────────────────────

    it "allows operator access" do
      post "/api/exports",
           params: { entity_type: "signals", format: "csv" },
           headers: auth_headers(operator)

      expect(response).to have_http_status(:ok)
    end

    it "allows viewer access" do
      post "/api/exports",
           params: { entity_type: "signals", format: "csv" },
           headers: auth_headers(viewer)

      expect(response).to have_http_status(:ok)
    end

    # ── Filter passthrough ───────────────────────────────────────────────

    it "filters signals by source" do
      post "/api/exports",
           params: { entity_type: "signals", format: "json", source: "ais" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["count"]).to eq(1)
      expect(body["records"].first["source"]).to eq("ais")
    end

    it "filters signals by signal_type" do
      post "/api/exports",
           params: { entity_type: "signals", format: "json", signal_type: "seismic_event" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["count"]).to eq(1)
      expect(body["records"].first["signal_type"]).to eq("seismic_event")
    end

    it "filters signal_rule_matches by workflow_status" do
      create(:signal_rule_match, workflow_status: "unacknowledged")
      create(:signal_rule_match, workflow_status: "closed")

      post "/api/exports",
           params: { entity_type: "signal_rule_matches", format: "json", workflow_status: "closed" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["count"]).to eq(1)
      expect(body["records"].first["workflow_status"]).to eq("closed")
    end

    it "filters tasks by priority" do
      site = create(:site)
      create(:task, priority: "critical", site: site)
      create(:task, priority: "low", site: site)

      post "/api/exports",
           params: { entity_type: "tasks", format: "json", priority: "critical" },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["count"]).to eq(1)
      expect(body["records"].first["priority"]).to eq("critical")
    end
  end
end
