require "rails_helper"

RSpec.describe "Api::Ai", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator) }

  # ── /api/ai/filter ─────────────────────────────────────────────────────────

  describe "GET /api/ai/filter" do
    it "requires authentication" do
      get "/api/ai/filter", params: { q: "test" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 403 for operators" do
      get "/api/ai/filter", params: { q: "test" }, headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns task filter data for commanders" do
      expect(Ai::FilterService).to receive(:call).with(
        query: "show high priority tasks",
        user: commander,
      ).and_return(
        ServiceResult.success(
          original_query: "show high priority tasks",
          filters: {
            site_id: nil,
            workflow_status: "triaged",
            priority: "high",
            created_after: nil,
            created_before: nil,
          },
        ),
      )

      get "/api/ai/filter", params: { q: "show high priority tasks" }, headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq(
        "data" => {
          "original_query" => "show high priority tasks",
          "filters" => {
            "site_id" => nil,
            "workflow_status" => "triaged",
            "priority" => "high",
            "created_after" => nil,
            "created_before" => nil,
          },
        },
      )
    end

    it "surfaces task filter validation failures" do
      expect(Ai::FilterService).to receive(:call).with(
        query: "show high priority tasks",
        user: commander,
      ).and_return(
        ServiceResult.failure(errors: ["Task filter query timed out"]),
      )

      get "/api/ai/filter", params: { q: "show high priority tasks" }, headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("errors" => ["Task filter query timed out"])
    end

    it "returns signal filter data for commanders" do
      expect(Ai::SignalFilterService).to receive(:call).with(
        query: "show gps jamming signals near alpha",
        user: commander,
      ).and_return(
        ServiceResult.success(
          original_query: "show gps jamming signals near alpha",
          filters: {
            signal_type: "gps_jamming",
            source: "gpsjam",
            site_id: "site-1",
            from: nil,
            to: "2026-04-01T10:00:00Z",
          },
        ),
      )

      get "/api/ai/filter",
          params: { q: "show gps jamming signals near alpha", entity_type: "signals" },
          headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq(
        "data" => {
          "original_query" => "show gps jamming signals near alpha",
          "filters" => {
            "signal_type" => "gps_jamming",
            "source" => "gpsjam",
            "site_id" => "site-1",
            "from" => nil,
            "to" => "2026-04-01T10:00:00Z",
          },
        },
      )
    end

    it "surfaces signal filter validation failures" do
      expect(Ai::SignalFilterService).to receive(:call).with(
        query: "show gps jamming signals near alpha",
        user: commander,
      ).and_return(
        ServiceResult.failure(errors: ["Signal filter query timed out"]),
      )

      get "/api/ai/filter",
          params: { q: "show gps jamming signals near alpha", entity_type: "signals" },
          headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("errors" => ["Signal filter query timed out"])
    end

    it "fails closed on foreign site ids for scoped commanders" do
      org = create(:organization)
      scoped_commander = create(:user, :commander, organization: org)
      create(:site, name: "Forward Site Alpha", organization: org)
      foreign_site = create(:site, name: "Foreign Site Bravo", organization: create(:organization))

      stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_specs"))
      tool_block = double("tool_block", type: :tool_use, name: Ai::FilterService::TOOL_NAME, input: {
        "site_id" => foreign_site.id,
        "workflow_status" => "triaged",
      })
      fake_response = double("anthropic_response", content: [tool_block])
      fake_messages = double("messages", create: fake_response)
      fake_client = double("anthropic_client", messages: fake_messages)
      allow(Anthropic::Client).to receive(:new).and_return(fake_client)

      get "/api/ai/filter", params: { q: "show triaged tasks at foreign site bravo" }, headers: auth_headers(scoped_commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("data", "filters", "site_id")).to be_nil
    end
  end

  # ── /api/ai/ontology_query ──────────────────────────────────────────────────

  describe "POST /api/ai/ontology_query" do
    let(:valid_payload) do
      {
        q: "show incidents, tasks, and alerts connected to Forward Site Alpha",
      }
    end

    it "requires authentication" do
      post "/api/ai/ontology_query", params: valid_payload, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 403 for operators" do
      post "/api/ai/ontology_query", params: valid_payload, headers: auth_headers(operator), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns ontology graph data for commanders" do
      expect(Ai::OntologyQueryService).to receive(:call).with(
        query: valid_payload[:q],
        as_of: nil,
        user: commander,
      ).and_return(
        ServiceResult.success(
          original_query: valid_payload[:q],
          summary: "Resolved Forward Site Alpha as the focal site.",
          normalized_query: {
            root_type: "site",
            root_id: "site-1",
            root_label: "Forward Site Alpha",
            relations: %w[incidents tasks alerts],
            time_window_hours: 72,
            limit: 8,
          },
          nodes: [
            { id: "site:site-1", entity_id: "site-1", type: "site", label: "Forward Site Alpha", sublabel: "Site · active", root: true, metadata: {} },
            { id: "incident:inc-1", entity_id: "inc-1", type: "incident", label: "Harbor breach watch", sublabel: "Incident · high · open", root: false, metadata: {} },
          ],
          edges: [
            { source: "site:site-1", target: "incident:inc-1", relation: "site_incident" },
          ],
          counts: {
            node_count: 2,
            edge_count: 1,
            by_type: { "site" => 1, "incident" => 1 },
          },
        ),
      )

      post "/api/ai/ontology_query", params: valid_payload, headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to include(
        "summary" => "Resolved Forward Site Alpha as the focal site.",
        "normalized_query" => include(
          "root_type" => "site",
          "root_label" => "Forward Site Alpha",
        ),
        "counts" => include(
          "node_count" => 2,
          "edge_count" => 1,
        ),
      )
      expect(body["data"]["nodes"].size).to eq(2)
      expect(body["data"]["edges"]).to eq(
        [{ "source" => "site:site-1", "target" => "incident:inc-1", "relation" => "site_incident" }],
      )
    end

    it "forwards the replay cutoff to the ontology service" do
      cutoff = Time.zone.parse("2026-04-02T12:00:00Z")

      expect(Ai::OntologyQueryService).to receive(:call).with(
        query: valid_payload[:q],
        as_of: cutoff,
        user: commander,
      ).and_return(ServiceResult.success(
        original_query: valid_payload[:q],
        summary: "ok",
        normalized_query: {
          root_type: "site",
          root_id: "site-1",
          root_label: "Forward Site Alpha",
          relations: %w[incidents],
          time_window_hours: 72,
          limit: 8,
          as_of: cutoff.iso8601,
        },
        nodes: [],
        edges: [],
        counts: { node_count: 0, edge_count: 0, by_type: {} },
      ))

      post "/api/ai/ontology_query",
           params: valid_payload.merge(as_of: cutoff.iso8601),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:ok)
    end

    it "returns 400 for an invalid ontology replay cutoff" do
      expect(Ai::OntologyQueryService).not_to receive(:call)

      post "/api/ai/ontology_query",
           params: valid_payload.merge(as_of: "not-a-real-timestamp"),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to eq("errors" => ["Invalid 'as_of' datetime"])
    end

    it "surfaces ontology service validation failures" do
      expect(Ai::OntologyQueryService).to receive(:call).with(
        query: "phantom base",
        as_of: nil,
        user: commander,
      ).and_return(
        ServiceResult.failure(errors: ["No site matched 'phantom base'"]),
      )

      post "/api/ai/ontology_query", params: { q: "phantom base" }, headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("errors" => ["No site matched 'phantom base'"])
    end

    it "does not resolve foreign roots for scoped commanders" do
      org = create(:organization)
      scoped_commander = create(:user, :commander, organization: org)
      create(:site, name: "Forward Site Alpha", organization: org)
      create(:site, name: "Foreign Site Bravo", organization: create(:organization))

      stub_const("ENV", ENV.to_h.merge("ANTHROPIC_API_KEY" => "test_key_for_specs"))
      tool_block = double("tool_block", type: :tool_use, name: Ai::OntologyQueryService::TOOL_NAME, input: {
        "root_type" => "site",
        "root_name" => "Foreign Site Bravo",
        "relations" => ["incidents"],
        "time_window_hours" => 24,
        "limit" => 4,
      })
      fake_response = double("anthropic_response", content: [tool_block])
      fake_messages = double("messages", create: fake_response)
      fake_client = double("anthropic_client", messages: fake_messages)
      allow(Anthropic::Client).to receive(:new).and_return(fake_client)

      post "/api/ai/ontology_query",
           params: { q: "show incidents connected to Foreign Site Bravo" },
           headers: auth_headers(scoped_commander),
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/No site matched 'Foreign Site Bravo'/)
    end
  end

  # ── /api/ai/export ─────────────────────────────────────────────────────────

  describe "POST /api/ai/export" do
    let!(:site)   { create(:site, name: "Alpha Site", status: "active", latitude: 10.0, longitude: 44.0) }

    let(:valid_payload) do
      {
        summary_type:   "leadership_briefing",
        summary:        "All sites are operating within normal parameters.",
        citations:      [],
        context_counts: { audit_events: 2, signals: 1, rule_fires: 0 }
      }
    end

    it "requires authentication" do
      post "/api/ai/export", params: valid_payload, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 403 for operators" do
      post "/api/ai/export", params: valid_payload, headers: auth_headers(operator), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns a PDF for commanders" do
      post "/api/ai/export", params: valid_payload, headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("application/pdf")
      expect(response.headers["Content-Disposition"]).to include("attachment")
      expect(response.headers["Content-Disposition"]).to include(".pdf")
    end

    it "returns 422 when summary is missing" do
      post "/api/ai/export",
           params:  valid_payload.except(:summary),
           headers: auth_headers(commander),
           as:      :json
      expect(response).to have_http_status(:bad_request)
    end

    it "returns 422 when summary_type is missing" do
      post "/api/ai/export",
           params:  valid_payload.except(:summary_type),
           headers: auth_headers(commander),
           as:      :json
      expect(response).to have_http_status(:bad_request)
    end

    it "includes citations in the PDF when provided" do
      payload = valid_payload.merge(citations: [SecureRandom.uuid, SecureRandom.uuid])
      post "/api/ai/export", params: payload, headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:ok)
      # PDF is binary — verify it starts with the PDF magic bytes
      expect(response.body.bytes.first(4)).to eq([37, 80, 68, 70])  # %PDF
    end

    it "accepts an optional site_name" do
      payload = valid_payload.merge(site_name: "Alpha Site")
      post "/api/ai/export", params: payload, headers: auth_headers(commander), as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  # ── /api/ai/summary ───────────────────────────────────────────────────────

  describe "POST /api/ai/summary" do
    let(:valid_payload) do
      {
        summary_type: "leadership_briefing",
      }
    end

    it "requires authentication" do
      post "/api/ai/summary", params: valid_payload, as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    it "returns 403 for operators" do
      post "/api/ai/summary", params: valid_payload, headers: auth_headers(operator), as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "returns summary data for commanders" do
      expect(Ai::SummaryService).to receive(:call).with(
        summary_type: "leadership_briefing",
        site_id: nil,
        from: nil,
        to: nil,
        user: commander,
      ).and_return(
        ServiceResult.success(
          summary: "Executive summary",
          citations: ["audit-1"],
          context_counts: { audit_events: 2, signals: 1, rule_fires: 0 },
        ),
      )

      post "/api/ai/summary", params: valid_payload, headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to include(
        "summary" => "Executive summary",
        "citations" => ["audit-1"],
        "context_counts" => {
          "audit_events" => 2,
          "signals" => 1,
          "rule_fires" => 0,
        },
      )
    end

    it "surfaces service validation failures" do
      expect(Ai::SummaryService).to receive(:call).with(
        summary_type: "leadership_briefing",
        site_id: nil,
        from: nil,
        to: nil,
        user: commander,
      ).and_return(
        ServiceResult.failure(errors: ["ANTHROPIC_API_KEY is not set"]),
      )

      post "/api/ai/summary", params: valid_payload, headers: auth_headers(commander), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("errors" => ["ANTHROPIC_API_KEY is not set"])
    end

    it "returns not found when a scoped commander requests a foreign site summary" do
      org = create(:organization)
      scoped_commander = create(:user, :commander, organization: org)
      foreign_site = create(:site, organization: create(:organization))
      expect(Anthropic::Client).not_to receive(:new)

      post "/api/ai/summary",
           params: { summary_type: "site_activity", site_id: foreign_site.id },
           headers: auth_headers(scoped_commander),
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("errors" => ["Site not found"])
    end

    # Tranche 1 fix: malformed datetime params now fail closed at the
    # controller boundary instead of silently nil-ing through to the
    # service. Mirrors signals_controller's pattern + ontology_query.
    it "returns 400 when 'from' is a malformed datetime" do
      expect(Ai::SummaryService).not_to receive(:call)

      post "/api/ai/summary",
           params: valid_payload.merge(from: "not-a-date"),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to eq("errors" => ["Invalid 'from' datetime"])
    end

    it "returns 400 when 'to' is a malformed datetime" do
      expect(Ai::SummaryService).not_to receive(:call)

      post "/api/ai/summary",
           params: valid_payload.merge(to: "garbage"),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to eq("errors" => ["Invalid 'to' datetime"])
    end

    it "still treats blank 'from' / 'to' as nil (no filter), not as a 400" do
      expect(Ai::SummaryService).to receive(:call).with(
        hash_including(from: nil, to: nil)
      ).and_return(ServiceResult.success(summary: "ok", citations: [], context_counts: {}))

      post "/api/ai/summary",
           params: valid_payload.merge(from: "", to: ""),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:ok)
    end

    it "accepts a well-formed 'from' / 'to' and forwards parsed Time values to the service" do
      expect(Ai::SummaryService).to receive(:call) do |kwargs|
        expect(kwargs[:from]).to be_a(ActiveSupport::TimeWithZone)
        expect(kwargs[:to]).to   be_a(ActiveSupport::TimeWithZone)
        expect(kwargs[:from].iso8601).to eq("2026-04-01T00:00:00Z")
        ServiceResult.success(summary: "ok", citations: [], context_counts: {})
      end

      post "/api/ai/summary",
           params: valid_payload.merge(from: "2026-04-01T00:00:00Z", to: "2026-04-25T00:00:00Z"),
           headers: auth_headers(commander),
           as: :json

      expect(response).to have_http_status(:ok)
    end
  end

  # ── Per-user rate limiting ─────────────────────────────────────────────────

  describe "per-user AI throttle" do
    let(:commander_a) { create(:user, :commander, email: "a@example.mil") }
    let(:commander_b) { create(:user, :commander, email: "b@example.mil") }

    before do
      # Stub the filter service so the throttle — not Anthropic — drives the
      # response. A success result keeps the response at 200 until the
      # throttle trips.
      allow(Ai::FilterService).to receive(:call).and_return(
        ServiceResult.success(original_query: "q", filters: {})
      )
    end

    it "throttles one user's AI calls without blocking a different user on the same IP" do
      # Burn commander_a's per-minute bucket.
      Rack::Attack::AI_USER_REQUESTS_PER_MINUTE.times do
        get "/api/ai/filter", params: { q: "tasks" }, headers: auth_headers(commander_a)
        expect(response).to have_http_status(:ok)
      end

      # Next call from commander_a is throttled — per-user limit hit.
      get "/api/ai/filter", params: { q: "tasks" }, headers: auth_headers(commander_a)
      expect(response).to have_http_status(:too_many_requests)

      # A different user (same IP in a test env) can still call — proves the
      # throttle is user-scoped, not IP-scoped. The IP throttle at
      # AI_IP_REQUESTS_PER_MINUTE is higher than the per-user limit so we
      # have room.
      get "/api/ai/filter", params: { q: "tasks" }, headers: auth_headers(commander_b)
      expect(response).to have_http_status(:ok)
    end
  end
end
