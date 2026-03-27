require "rails_helper"

RSpec.describe "Api::SaluteReports", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator) { create(:user, :operator) }
  let(:ao) { create(:area_of_operation, name: "Littoral West") }
  let(:site) { create(:site, area_of_operation: ao, name: "Watchtower Bravo") }

  describe "POST /api/salute_reports" do
    let(:valid_params) do
      {
        salute_report: {
          area_of_operation_id: ao.id,
          site_id: site.id,
          size: "2 fast boats",
          activity: "Shadowing patrol route from the east.",
          location: "Harbor ingress channel",
          unit: "Unknown irregular maritime element",
          observed_at: "2026-03-27T09:45:00Z",
          equipment: "Handheld radios",
          remarks: "Maintained contact for six minutes before breaking east.",
        }
      }
    end

    it "creates an append-only SALUTE report and writes an audit event" do
      expect {
        post "/api/salute_reports", params: valid_params, headers: auth_headers(commander)
      }.to change(SaluteReport, :count).by(1).and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["site_name"]).to eq("Watchtower Bravo")
      expect(body["area_of_operation_name"]).to eq("Littoral West")
      expect(AuditEvent.last.event_type).to eq("salute_report.created")
    end

    it "rejects a site outside the selected area of operation" do
      foreign_site = create(:site, area_of_operation: create(:area_of_operation))

      post "/api/salute_reports",
           params: {
             salute_report: valid_params[:salute_report].merge(site_id: foreign_site.id)
           },
           headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"].first).to match(/must belong to the selected area of operation/)
    end

    it "forbids operators" do
      post "/api/salute_reports", params: valid_params, headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end
end
