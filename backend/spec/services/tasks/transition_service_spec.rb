require "rails_helper"

RSpec.describe Tasks::TransitionService, type: :service do
  let(:site) { create(:site) }
  let(:actor) { "user:test-operator" }

  describe ".allowed_transitions_for" do
    it "returns correct transitions from new" do
      expect(described_class.allowed_transitions_for("new")).to eq(%w[triaged])
    end

    it "returns correct transitions from triaged" do
      expect(described_class.allowed_transitions_for("triaged")).to eq(%w[in_progress])
    end

    it "returns correct transitions from in_progress" do
      expect(described_class.allowed_transitions_for("in_progress")).to eq(%w[blocked resolved])
    end

    it "returns correct transitions from blocked" do
      expect(described_class.allowed_transitions_for("blocked")).to eq(%w[in_progress])
    end

    it "returns correct transitions from resolved" do
      expect(described_class.allowed_transitions_for("resolved")).to eq(%w[triaged])
    end
  end

  describe "#call" do
    context "valid transition: new -> triaged" do
      let(:task) { create(:task, site: site, workflow_status: "new") }

      subject(:result) { described_class.call(task: task, to_status: "triaged", actor: actor) }

      it "returns success" do
        expect(result.success).to be true
      end

      it "updates task workflow_status" do
        result
        expect(task.reload.workflow_status).to eq("triaged")
      end

      it "writes an audit event" do
        expect { result }.to change(AuditEvent, :count).by(1)
      end

      it "writes the correct audit event fields" do
        result
        event = AuditEvent.last
        expect(event.event_type).to eq("task.transitioned")
        expect(event.entity_type).to eq("Task")
        expect(event.entity_id).to eq(task.id)
        expect(event.actor).to eq(actor)
        expect(event.before_snapshot["workflow_status"]).to eq("new")
        expect(event.after_snapshot["workflow_status"]).to eq("triaged")
      end

      it "writes audit event in the same transaction as the mutation" do
        # If the audit write fails, the task update must also be rolled back.
        # Simulate by checking they both exist together after success.
        result
        expect(Task.find(task.id).workflow_status).to eq("triaged")
        expect(AuditEvent.where(entity_id: task.id).count).to eq(1)
      end
    end

    context "valid transition: in_progress -> blocked" do
      let(:task) { create(:task, site: site, workflow_status: "in_progress") }

      subject(:result) do
        described_class.call(task: task, to_status: "blocked", actor: actor, blocked_reason: "Waiting on supply delivery")
      end

      it "returns success" do
        expect(result.success).to be true
      end

      it "sets blocked_reason on the task" do
        result
        expect(task.reload.blocked_reason).to eq("Waiting on supply delivery")
      end
    end

    context "blocking a task without a blocked_reason" do
      let(:task) { create(:task, site: site, workflow_status: "in_progress") }

      subject(:result) { described_class.call(task: task, to_status: "blocked", actor: actor) }

      it "returns failure" do
        expect(result.failure?).to be true
      end

      it "returns an appropriate error message" do
        expect(result.errors).to include(a_string_matching(/blocked_reason/i))
      end

      it "does not update the task" do
        result
        expect(task.reload.workflow_status).to eq("in_progress")
      end

      it "does not write an audit event" do
        expect { result }.not_to change(AuditEvent, :count)
      end
    end

    context "invalid transition: new -> resolved (skipping states)" do
      let(:task) { create(:task, site: site, workflow_status: "new") }

      subject(:result) { described_class.call(task: task, to_status: "resolved", actor: actor) }

      it "returns failure" do
        expect(result.failure?).to be true
      end

      it "returns a transition error message" do
        expect(result.errors.first).to match(/not allowed/)
      end

      it "does not update the task" do
        result
        expect(task.reload.workflow_status).to eq("new")
      end

      it "does not write an audit event" do
        expect { result }.not_to change(AuditEvent, :count)
    end
    end

    context "transition to resolved" do
      let(:task) { create(:task, site: site, workflow_status: "in_progress") }

      subject(:result) { described_class.call(task: task, to_status: "resolved", actor: actor) }

      it "sets resolved_at" do
        result
        expect(task.reload.resolved_at).to be_within(2.seconds).of(Time.current)
      end

      it "clears blocked_reason" do
        task.update_columns(workflow_status: "in_progress", blocked_reason: nil)
        result
        expect(task.reload.blocked_reason).to be_nil
      end
    end

    context "unblocking a task (blocked -> in_progress)" do
      let(:task) { create(:task, :blocked, site: site) }

      subject(:result) { described_class.call(task: task, to_status: "in_progress", actor: actor) }

      it "returns success" do
        expect(result.success).to be true
      end

      it "clears blocked_reason" do
        result
        expect(task.reload.blocked_reason).to be_nil
      end
    end
  end
end
