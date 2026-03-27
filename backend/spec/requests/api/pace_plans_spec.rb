require "rails_helper"

RSpec.describe "Api::PacePlans", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:operator) { create(:user, :operator) }
  let(:ao) { create(:area_of_operation, name: "Northern Arc") }

  describe "POST /api/pace_plans" do
    let(:valid_params) do
      {
        pace_plan: {
          area_of_operation_id: ao.id,
          primary_plan: "SATCOM mission chat",
          alternate_plan: "Secure VHF relay",
          contingency_plan: "Burst SMS via field gateway",
          emergency_plan: "HF voice net",
          notes: "Switch to contingency if packet loss exceeds 15%.",
        }
      }
    end

    it "creates a PACE plan and writes an audit event" do
      expect {
        post "/api/pace_plans", params: valid_params, headers: auth_headers(commander)
      }.to change(PacePlan, :count).by(1).and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["area_of_operation_id"]).to eq(ao.id)
      expect(AuditEvent.last.event_type).to eq("pace_plan.created")
    end

    it "forbids operators" do
      post "/api/pace_plans", params: valid_params, headers: auth_headers(operator)

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/pace_plans/:id" do
    let!(:plan) { create(:pace_plan, area_of_operation: ao) }

    it "updates the PACE plan and writes an audit event" do
      original_emergency_plan = plan.emergency_plan

      patch "/api/pace_plans/#{plan.id}",
            params: { pace_plan: { emergency_plan: "Courier dispatch from nearest site" } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["emergency_plan"]).to eq("Courier dispatch from nearest site")
      expect(AuditEvent.last.event_type).to eq("pace_plan.updated")
      expect(AuditEvent.last.before_snapshot["emergency_plan"]).to eq(original_emergency_plan)
    end

    it "rejects area_of_operation_id reassignment on update" do
      other_ao = create(:area_of_operation, name: "Eastern Corridor")

      patch "/api/pace_plans/#{plan.id}",
            params: { pace_plan: { area_of_operation_id: other_ao.id, notes: "Updated notes" } },
            headers: auth_headers(commander)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to include("area_of_operation_id cannot be changed")
      expect(plan.reload.area_of_operation_id).to eq(ao.id)
    end
  end
end
