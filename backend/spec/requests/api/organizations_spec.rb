require "rails_helper"

RSpec.describe "Api::Organizations", type: :request do
  let(:admin)     { create(:user, role: "admin") }
  let(:commander) { create(:user, role: "commander") }
  let(:operator)  { create(:user, role: "operator") }

  let!(:org_alpha) { create(:organization, name: "Alpha Corp", slug: "alpha-corp") }
  let!(:org_bravo) { create(:organization, name: "Bravo Inc",  slug: "bravo-inc") }

  describe "GET /api/organizations" do
    it "returns 200 with data array and pagination meta for admin" do
      get "/api/organizations", headers: auth_headers(admin)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["data"]).to be_an(Array)
      expect(body["data"].size).to eq(2)
      expect(body["meta"]).to include("total", "page", "per_page", "total_pages")
    end

    it "returns organizations in name order" do
      get "/api/organizations", headers: auth_headers(admin)
      names = JSON.parse(response.body)["data"].map { |o| o["name"] }
      expect(names).to eq(["Alpha Corp", "Bravo Inc"])
    end

    it "returns user_count and site_count in each record" do
      create(:user, role: "operator", organization: org_alpha)
      get "/api/organizations", headers: auth_headers(admin)
      alpha = JSON.parse(response.body)["data"].find { |o| o["slug"] == "alpha-corp" }
      expect(alpha["user_count"]).to eq(1)
      expect(alpha["site_count"]).to eq(0)
    end

    it "returns 403 for non-admin commander" do
      get "/api/organizations", headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for operator" do
      get "/api/organizations", headers: auth_headers(operator)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/organizations/:id" do
    it "returns 200 with organization details for admin" do
      get "/api/organizations/#{org_alpha.id}", headers: auth_headers(admin)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("Alpha Corp")
      expect(body["slug"]).to eq("alpha-corp")
    end

    it "allows a commander to see their own organization" do
      commander.update!(organization: org_alpha)
      get "/api/organizations/#{org_alpha.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
    end

    it "returns 404 for a commander requesting another organization" do
      commander.update!(organization: org_alpha)
      get "/api/organizations/#{org_bravo.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/organizations" do
    let(:valid_params) { { organization: { name: "Charlie Ltd", slug: "charlie-ltd" } } }

    it "creates an organization as admin" do
      expect {
        post "/api/organizations", params: valid_params, headers: auth_headers(admin)
      }.to change(Organization, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("Charlie Ltd")
      expect(body["slug"]).to eq("charlie-ltd")
    end

    it "writes an audit event on create" do
      expect {
        post "/api/organizations", params: valid_params, headers: auth_headers(admin)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("organization_created")
      expect(event.entity_type).to eq("Organization")
    end

    it "returns 422 for invalid slug" do
      post "/api/organizations",
           params: { organization: { name: "Bad", slug: "INVALID SLUG" } },
           headers: auth_headers(admin)
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 422 for duplicate slug" do
      post "/api/organizations",
           params: { organization: { name: "Dup", slug: "alpha-corp" } },
           headers: auth_headers(admin)
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 403 for non-admin" do
      post "/api/organizations", params: valid_params, headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/organizations/:id" do
    it "updates the organization name as admin" do
      patch "/api/organizations/#{org_alpha.id}",
            params: { organization: { name: "Alpha Corp Rebranded" } },
            headers: auth_headers(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["name"]).to eq("Alpha Corp Rebranded")
    end

    it "writes an audit event on update" do
      expect {
        patch "/api/organizations/#{org_alpha.id}",
              params: { organization: { name: "Updated" } },
              headers: auth_headers(admin)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("organization_updated")
    end

    it "returns 404 for non-admin (org not in policy scope)" do
      patch "/api/organizations/#{org_alpha.id}",
            params: { organization: { name: "Nope" } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/organizations/:id" do
    it "deletes an empty organization as admin" do
      expect {
        delete "/api/organizations/#{org_alpha.id}", headers: auth_headers(admin)
      }.to change(Organization, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end

    it "writes an audit event on delete" do
      expect {
        delete "/api/organizations/#{org_alpha.id}", headers: auth_headers(admin)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("organization_deleted")
    end

    it "returns 422 when organization has users" do
      create(:user, role: "operator", organization: org_alpha)

      delete "/api/organizations/#{org_alpha.id}", headers: auth_headers(admin)
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to include("users")
    end

    it "returns 404 for non-admin (org not in policy scope)" do
      delete "/api/organizations/#{org_alpha.id}", headers: auth_headers(commander)
      expect(response).to have_http_status(:not_found)
    end
  end
end
