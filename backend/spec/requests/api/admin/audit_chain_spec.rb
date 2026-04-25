require "rails_helper"

RSpec.describe "Api::Admin::AuditChain", type: :request do
  let(:org)        { create(:organization) }
  let(:admin)      { create(:user, :admin) }
  let(:commander)  { create(:user, :commander) }
  let(:operator)   { create(:user, :operator) }

  describe "GET /api/admin/audit_chain" do
    it "returns 200 + verification payload when called by an admin" do
      Audit::EventWriter.write(
        actor:          admin,
        entity_type:    "Organization",
        entity_id:      org.id,
        event_type:     "org.touched",
        action:         "touch",
        after_snapshot: { "id" => org.id, "marker" => "x" },
        correlation_id: SecureRandom.uuid,
      )

      get "/api/admin/audit_chain", headers: auth_headers(admin)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("checked_at", "chains", "rows_checked", "all_valid")
      expect(body["meta"]["all_valid"]).to be(true)
    end

    it "is forbidden for a commander (admin-only surface)" do
      get "/api/admin/audit_chain", headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
    end

    it "is forbidden for an operator" do
      get "/api/admin/audit_chain", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "is unauthorized when no token is supplied" do
      get "/api/admin/audit_chain"
      expect(response).to have_http_status(:unauthorized)
    end

    it "reports a break when the chain has been tampered" do
      e1 = Audit::EventWriter.write(
        actor:          admin,
        entity_type:    "Organization",
        entity_id:      org.id,
        event_type:     "org.touched",
        action:         "touch",
        after_snapshot: { "id" => org.id, "marker" => "x" },
        correlation_id: SecureRandom.uuid,
      )

      conn = ActiveRecord::Base.connection
      conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_update")
      AuditEvent.unscoped.where(id: e1.id).update_all(actor: "evil")
      conn.execute("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable_update")

      get "/api/admin/audit_chain", headers: auth_headers(admin)

      body = JSON.parse(response.body)
      expect(body["meta"]["all_valid"]).to be(false)
      tampered = body["data"].find { |c| c["organization_id"] == org.id }
      expect(tampered["valid"]).to be(false)
      expect(tampered["reason"]).to match(/row_hash recomputation/)
    end
  end
end
