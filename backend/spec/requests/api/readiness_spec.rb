require "rails_helper"

RSpec.describe "Api::Readiness", type: :request do
  let!(:site_a) { create(:site, name: "Alpha") }
  let!(:site_b) { create(:site, name: "Bravo") }

  describe "GET /api/readiness (live)" do
    context "when site_a has all resolved tasks" do
      before do
        create_list(:task, 2, :resolved, site: site_a)
      end

      it "returns 200 with readiness for all sites" do
        get "/api/readiness"
        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body.length).to eq(2)
        site_ids = body.map { |r| r["site_id"] }
        expect(site_ids).to contain_exactly(site_a.id, site_b.id)
      end

      it "returns score 1.0 for a site with all resolved tasks" do
        get "/api/readiness"
        alpha_result = JSON.parse(response.body).find { |r| r["site_id"] == site_a.id }
        expect(alpha_result["score"]).to eq(1.0)
      end

      it "returns nil score for a site with no tasks" do
        get "/api/readiness"
        bravo_result = JSON.parse(response.body).find { |r| r["site_id"] == site_b.id }
        expect(bravo_result["score"]).to be_nil
      end

      it "returns expected fields" do
        get "/api/readiness"
        result = JSON.parse(response.body).first
        expect(result.keys).to include("site_id", "site_name", "score", "counts", "computed_at", "as_of")
      end

      it "returns as_of as nil when not requested" do
        get "/api/readiness"
        result = JSON.parse(response.body).first
        expect(result["as_of"]).to be_nil
      end
    end
  end

  describe "GET /api/readiness with ?as_of= (replay)" do
    let!(:task) { create(:task, site: site_a) }
    # event created 2 hours ago; as_of is 1 hour ago — clearly after the event
    let(:event_at) { 2.hours.ago }
    let(:as_of_time) { 1.hour.ago }

    before do
      # Plant an audit event with a resolved state in the past
      AuditEvent.create!(
        schema_version: 1,
        actor: "test",
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: task.attributes.merge("workflow_status" => "resolved").except("updated_at"),
        correlation_id: SecureRandom.uuid,
        occurred_at: event_at
      )
    end

    it "returns score based on historical task state" do
      get "/api/readiness", params: { as_of: as_of_time.iso8601 }
      expect(response).to have_http_status(:ok)
      result = JSON.parse(response.body).find { |r| r["site_id"] == site_a.id }
      # The snapshot shows the task as resolved -> score = 1.0
      expect(result["score"]).to eq(1.0)
    end

    it "echoes as_of in the response" do
      get "/api/readiness", params: { as_of: as_of_time.iso8601 }
      result = JSON.parse(response.body).first
      expect(result["as_of"]).not_to be_nil
    end
  end
end
