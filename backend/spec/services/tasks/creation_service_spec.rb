require "rails_helper"

RSpec.describe Tasks::CreationService do
  let(:actor)  { create(:user, :commander) }
  let(:site)   { create(:site) }

  describe "successful creation" do
    it "creates a task and returns success" do
      result = described_class.call(
        params: { title: "Patrol sector Alpha", site_id: site.id, priority: "high", workflow_status: "new" },
        actor: actor,
      )

      expect(result).to be_success
      task = result.payload[:task]
      expect(task).to be_persisted
      expect(task.title).to eq("Patrol sector Alpha")
      expect(task.priority).to eq("high")
      expect(task.site_id).to eq(site.id)
    end

    it "writes an audit event in the same transaction" do
      expect {
        described_class.call(
          params: { title: "Recon", site_id: site.id, priority: "normal", workflow_status: "new" },
          actor: actor,
        )
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("task.created")
      expect(event.entity_type).to eq("Task")
      expect(event.actor).to be_present
      expect(event.after_snapshot).to include("title" => "Recon")
      expect(event.correlation_id).to be_present
    end

    it "stores correlation metadata on the audit event" do
      metadata = { rule_id: SecureRandom.uuid, signal_id: SecureRandom.uuid }

      described_class.call(
        params: { title: "System task", site_id: site.id, priority: "critical", workflow_status: "new" },
        actor: actor,
        metadata: metadata,
      )

      event = AuditEvent.last
      expect(event.metadata).to include("rule_id" => metadata[:rule_id])
      expect(event.metadata).to include("signal_id" => metadata[:signal_id])
    end

    it "excludes updated_at from the audit snapshot" do
      result = described_class.call(
        params: { title: "Snapshot test", site_id: site.id, priority: "low", workflow_status: "new" },
        actor: actor,
      )

      event = AuditEvent.last
      expect(event.after_snapshot).not_to have_key("updated_at")
    end
  end

  describe "validation failures" do
    it "returns failure when title is missing" do
      result = described_class.call(
        params: { site_id: site.id, priority: "normal", workflow_status: "new" },
        actor: actor,
      )

      expect(result).not_to be_success
      expect(result.errors).to include(a_string_matching(/title/i))
    end

    it "returns failure for invalid priority" do
      result = described_class.call(
        params: { title: "Bad priority", site_id: site.id, priority: "urgent", workflow_status: "new" },
        actor: actor,
      )

      expect(result).not_to be_success
      expect(result.errors).to include(a_string_matching(/priority/i))
    end

    it "does not create an audit event on validation failure" do
      expect {
        described_class.call(
          params: { site_id: site.id, priority: "normal", workflow_status: "new" },
          actor: actor,
        )
      }.not_to change(AuditEvent, :count)
    end

    it "does not persist a task on validation failure" do
      expect {
        described_class.call(
          params: { site_id: site.id, priority: "normal", workflow_status: "new" },
          actor: actor,
        )
      }.not_to change(Task, :count)
    end
  end

  describe "transaction atomicity" do
    it "rolls back task if audit event creation fails" do
      allow(Audit::EventWriter).to receive(:write).and_raise(ActiveRecord::RecordInvalid.new(AuditEvent.new))

      expect {
        described_class.call(
          params: { title: "Rollback test", site_id: site.id, priority: "normal", workflow_status: "new" },
          actor: actor,
        )
      }.not_to change(Task, :count)
    end
  end
end
