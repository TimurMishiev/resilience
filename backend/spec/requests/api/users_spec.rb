require "rails_helper"

RSpec.describe "Api::Users", type: :request do
  let(:admin)     { create(:user, role: "admin") }
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:org) { create(:organization, name: "Alpha Corp", slug: "alpha-corp") }

  describe "GET /api/users" do
    it "returns 200 with data array and pagination meta for admin" do
      get "/api/users", headers: auth_headers(admin)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns users in email order" do
      get "/api/users", headers: auth_headers(admin)
      emails = JSON.parse(response.body)["data"].map { |u| u["email"] }
      expect(emails).to eq(emails.sort)
    end

    it "includes organization_name when user is assigned to an org" do
      operator.update!(organization: org)
      get "/api/users", headers: auth_headers(admin)
      op = JSON.parse(response.body)["data"].find { |u| u["email"] == operator.email }
      expect(op["organization_name"]).to eq("Alpha Corp")
    end

    it "returns 403 for non-commander" do
      get "/api/users", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for non-admin commander (passes require_commander! but denied by policy)" do
      get "/api/users", headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/users/:id" do
    it "updates organization assignment as admin" do
      patch "/api/users/#{operator.id}",
            params: { user: { organization_id: org.id } },
            headers: auth_headers(admin)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["organization_id"]).to eq(org.id)
      expect(body["organization_name"]).to eq("Alpha Corp")
    end

    it "clears organization assignment when null" do
      operator.update!(organization: org)
      patch "/api/users/#{operator.id}",
            params: { user: { organization_id: nil } },
            headers: auth_headers(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["organization_id"]).to be_nil
    end

    it "updates role as admin" do
      patch "/api/users/#{operator.id}",
            params: { user: { role: "commander" } },
            headers: auth_headers(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["role"]).to eq("commander")
    end

    it "writes an audit event on update" do
      expect {
        patch "/api/users/#{operator.id}",
              params: { user: { organization_id: org.id } },
              headers: auth_headers(admin)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("user_updated")
      expect(event.entity_type).to eq("User")
    end

    it "returns 422 for invalid role" do
      patch "/api/users/#{operator.id}",
            params: { user: { role: "superadmin" } },
            headers: auth_headers(admin)
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 404 for non-admin commander (not in policy scope)" do
      patch "/api/users/#{operator.id}",
            params: { user: { organization_id: org.id } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end
end
