require 'rails_helper'

# Defense-in-depth backstop for replay mode. The frontend's
# useReplayGuardedMutation hook is the primary block, but a non-browser
# caller (curl, automation) or a frontend regression bypass could
# previously mutate live state under an as_of request — operator intent
# ("I am viewing history") would diverge from server effect.
#
# Audit chain remained causally correct either way (Audit::EventWriter
# always uses Time.current for occurred_at), but the operator-intent
# divergence is itself the defect. This spec pins the backend guard
# implemented in Api::BaseController#reject_replay_mutations!.
RSpec.describe "Replay-mode mutation guard", type: :request do
  let(:commander) { create(:user, :commander) }
  let(:site)      { create(:site, organization: commander.organization) }
  let(:incident) do
    Incident.create!(
      title: "Replay guard fixture",
      site: site,
      status: "open",
      severity: "high",
      confidence: 0.5,
      opened_at: 2.hours.ago,
    ).tap { |r| r.update_columns(created_at: 2.hours.ago, updated_at: 2.hours.ago) }
  end
  let(:as_of_param) { 30.minutes.ago.iso8601 }
  let(:guard_message) { /replay mode is read-only/i }

  describe "incident mutations" do
    it "rejects PATCH /api/incidents/:id with as_of" do
      patch "/api/incidents/#{incident.id}",
            params: { as_of: as_of_param, incident: { title: "renamed" } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body).fetch("errors").first).to match(guard_message)
      expect(incident.reload.title).to eq("Replay guard fixture")
    end

    it "rejects POST /api/incidents/:id/transition with as_of" do
      post "/api/incidents/#{incident.id}/transition",
           params: { as_of: as_of_param, to_status: "acknowledged" },
           headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
      expect(incident.reload.status).to eq("open")
    end

    it "rejects PATCH /api/incidents/:id/assign with as_of" do
      patch "/api/incidents/#{incident.id}/assign",
            params: { as_of: as_of_param, assignee_id: commander.id },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
      expect(incident.reload.assigned_to_id).to be_nil
    end
  end

  describe "task mutations" do
    let(:task) do
      Task.create!(
        title: "Task fixture",
        site: site,
        priority: "normal",
        workflow_status: "new",
      )
    end

    it "rejects PATCH /api/tasks/:id with as_of" do
      patch "/api/tasks/#{task.id}",
            params: { as_of: as_of_param, task: { title: "renamed" } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
      expect(task.reload.title).to eq("Task fixture")
    end

    it "rejects POST /api/tasks with as_of" do
      post "/api/tasks",
           params: {
             as_of: as_of_param,
             task: { title: "ghost task", site_id: site.id, priority: "normal" },
           },
           headers: auth_headers(commander)
      expect(response).to have_http_status(:forbidden)
      expect(Task.where(title: "ghost task")).to be_empty
    end
  end

  describe "read paths still work with as_of (no false positives)" do
    it "permits GET /api/incidents with as_of" do
      get "/api/incidents",
          params: { as_of: as_of_param },
          headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
    end

    it "permits GET /api/incidents/:id with as_of" do
      get "/api/incidents/#{incident.id}",
          params: { as_of: as_of_param },
          headers: auth_headers(commander)
      # Created at fixture is 1 hour ago; as_of is 30 minutes ago — incident exists at as_of.
      expect(response).to have_http_status(:ok)
    end
  end

  describe "live mutations (no as_of) still work" do
    it "permits PATCH /api/incidents/:id without as_of" do
      patch "/api/incidents/#{incident.id}",
            params: { incident: { title: "live rename" } },
            headers: auth_headers(commander)
      expect(response).to have_http_status(:ok)
      expect(incident.reload.title).to eq("live rename")
    end
  end
end
