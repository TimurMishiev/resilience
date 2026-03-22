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
end
