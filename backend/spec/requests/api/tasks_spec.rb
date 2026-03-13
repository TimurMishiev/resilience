require "rails_helper"

RSpec.describe "Api::Tasks", type: :request do
  let!(:site) { create(:site) }

  describe "GET /api/tasks" do
    let!(:task_new)        { create(:task, site: site) }
    let!(:task_resolved)   { create(:task, :resolved, site: site) }
    let!(:task_other_site) { create(:task) }

    it "returns 200 with all tasks" do
      get "/api/tasks"
      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).map { |t| t["id"] }
      expect(ids).to include(task_new.id, task_resolved.id, task_other_site.id)
    end

    it "filters by site_id" do
      get "/api/tasks", params: { site_id: site.id }
      ids = JSON.parse(response.body).map { |t| t["id"] }
      expect(ids).to contain_exactly(task_new.id, task_resolved.id)
    end

    it "filters by workflow_status" do
      get "/api/tasks", params: { workflow_status: "resolved" }
      ids = JSON.parse(response.body).map { |t| t["id"] }
      expect(ids).to include(task_resolved.id)
      expect(ids).not_to include(task_new.id)
    end

    it "returns expected fields" do
      get "/api/tasks"
      task = JSON.parse(response.body).first
      expect(task.keys).to include(
        "id", "site_id", "title", "priority", "workflow_status", "created_at"
      )
    end
  end

  describe "GET /api/tasks/:id" do
    let!(:task) { create(:task, site: site) }

    it "returns 200 with the task" do
      get "/api/tasks/#{task.id}"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(task.id)
    end

    it "returns 404 for an unknown id" do
      get "/api/tasks/00000000-0000-0000-0000-000000000000"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/tasks" do
    let(:valid_params) do
      { task: { site_id: site.id, title: "New task", priority: "high" } }
    end

    it "creates a task and returns 201" do
      expect {
        post "/api/tasks", params: valid_params, as: :json
      }.to change(Task, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["title"]).to eq("New task")
      expect(body["priority"]).to eq("high")
      expect(body["workflow_status"]).to eq("new")
    end

    it "writes an audit event" do
      expect {
        post "/api/tasks", params: valid_params, as: :json
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("task.created")
      expect(event.actor).to eq("api:anonymous")
    end

    it "returns 422 when title is missing" do
      post "/api/tasks", params: { task: { site_id: site.id } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["errors"]).not_to be_empty
    end
  end

  describe "PATCH /api/tasks/:id" do
    let!(:task) { create(:task, site: site, title: "Original", priority: "normal") }

    it "updates allowed fields and returns 200" do
      patch "/api/tasks/#{task.id}", params: { task: { title: "Updated", priority: "high" } }, as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["title"]).to eq("Updated")
      expect(body["priority"]).to eq("high")
    end

    it "writes an audit event for the update" do
      expect {
        patch "/api/tasks/#{task.id}", params: { task: { title: "Updated" } }, as: :json
      }.to change(AuditEvent, :count).by(1)

      expect(AuditEvent.last.event_type).to eq("task.updated")
    end

    it "does not allow workflow_status to be changed via update" do
      patch "/api/tasks/#{task.id}", params: { task: { workflow_status: "resolved" } }, as: :json
      task.reload
      expect(task.workflow_status).to eq("new")
    end

    it "returns 404 for an unknown id" do
      patch "/api/tasks/00000000-0000-0000-0000-000000000000",
            params: { task: { title: "x" } }, as: :json
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/tasks/:id/transition" do
    let!(:task) { create(:task, site: site) }  # starts as "new"

    context "with a valid transition" do
      it "transitions the task and returns 200" do
        post "/api/tasks/#{task.id}/transition",
             params: { transition: { to_status: "triaged" } }, as: :json

        expect(response).to have_http_status(:ok)
        expect(JSON.parse(response.body)["workflow_status"]).to eq("triaged")
        expect(task.reload.workflow_status).to eq("triaged")
      end

      it "writes an audit event" do
        expect {
          post "/api/tasks/#{task.id}/transition",
               params: { transition: { to_status: "triaged" } }, as: :json
        }.to change(AuditEvent, :count).by(1)

        event = AuditEvent.last
        expect(event.event_type).to eq("task.transitioned")
        expect(event.metadata["to_status"]).to eq("triaged")
      end
    end

    context "with an invalid transition" do
      it "returns 422 and does not change the task" do
        # "new" -> "resolved" is not allowed
        post "/api/tasks/#{task.id}/transition",
             params: { transition: { to_status: "resolved" } }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(JSON.parse(response.body)["errors"]).not_to be_empty
        expect(task.reload.workflow_status).to eq("new")
      end
    end

    context "when transitioning to blocked" do
      let!(:triaged_task) { create(:task, :triaged, site: site) }

      before do
        post "/api/tasks/#{triaged_task.id}/transition",
             params: { transition: { to_status: "in_progress" } }, as: :json
      end

      it "requires blocked_reason" do
        post "/api/tasks/#{triaged_task.id}/transition",
             params: { transition: { to_status: "blocked" } }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(JSON.parse(response.body)["errors"].first).to match(/blocked_reason/)
      end

      it "succeeds when blocked_reason is provided" do
        post "/api/tasks/#{triaged_task.id}/transition",
             params: { transition: { to_status: "blocked", blocked_reason: "Waiting on parts" } }, as: :json

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["workflow_status"]).to eq("blocked")
        expect(body["blocked_reason"]).to eq("Waiting on parts")
      end
    end
  end

  describe "GET /api/tasks/:id/allowed_transitions" do
    it "returns allowed transitions for a new task" do
      task = create(:task, site: site)
      get "/api/tasks/#{task.id}/allowed_transitions"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["allowed"]).to eq(["triaged"])
    end

    it "returns allowed transitions for a resolved task" do
      task = create(:task, :resolved, site: site)
      get "/api/tasks/#{task.id}/allowed_transitions"
      expect(JSON.parse(response.body)["allowed"]).to eq(["triaged"])
    end

    it "returns 404 for an unknown task" do
      get "/api/tasks/00000000-0000-0000-0000-000000000000/allowed_transitions"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /api/tasks with ?as_of= (replay)" do
    let!(:task) { create(:task, site: site, title: "Original title") }
    let(:as_of_past) { 1.hour.ago.iso8601 }

    before do
      # Simulate a creation audit event that occurred 2 hours ago
      AuditEvent.create!(
        schema_version: 1,
        actor: "test",
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: task.attributes.merge("workflow_status" => "new").except("updated_at"),
        correlation_id: SecureRandom.uuid,
        occurred_at: 2.hours.ago
      )
    end

    it "returns the task state at the given point in time" do
      get "/api/tasks", params: { as_of: as_of_past, site_id: site.id }
      expect(response).to have_http_status(:ok)
      snapshots = JSON.parse(response.body)
      expect(snapshots).not_to be_empty
      expect(snapshots.first["id"]).to eq(task.id)
      expect(snapshots.first["workflow_status"]).to eq("new")
    end

    it "excludes tasks created after as_of" do
      future_task = create(:task, site: site)
      AuditEvent.create!(
        schema_version: 1,
        actor: "test",
        entity_type: "Task",
        entity_id: future_task.id,
        event_type: "task.created",
        action: "create",
        before_snapshot: nil,
        after_snapshot: future_task.attributes.except("updated_at"),
        correlation_id: SecureRandom.uuid,
        occurred_at: 30.minutes.ago  # After as_of_past (1 hour ago)
      )

      get "/api/tasks", params: { as_of: as_of_past, site_id: site.id }
      ids = JSON.parse(response.body).map { |t| t["id"] }
      expect(ids).not_to include(future_task.id)
    end
  end
end
