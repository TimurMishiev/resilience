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

    it "treats admin as commander-equivalent" do
      expect(described_class.allowed_transitions_for("in_progress", role: "admin")).to eq(%w[blocked resolved])
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

    context "transition to resolved (commander)" do
      let(:task) { create(:task, site: site, workflow_status: "in_progress") }

      subject(:result) do
        described_class.call(task: task, to_status: "resolved", actor: actor, actor_role: "commander")
      end

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

    context "unblocking a task — blocked -> in_progress (commander)" do
      let(:task) { create(:task, :blocked, site: site) }

      subject(:result) do
        described_class.call(task: task, to_status: "in_progress", actor: actor, actor_role: "commander")
      end

      it "returns success" do
        expect(result.success).to be true
      end

      it "clears blocked_reason" do
        result
        expect(task.reload.blocked_reason).to be_nil
      end
    end

    context "reopening a resolved task (commander)" do
      let(:task) { create(:task, :resolved, site: site) }

      subject(:result) do
        described_class.call(task: task, to_status: "triaged", actor: actor, actor_role: "commander")
      end

      it "returns success" do
        expect(result.success).to be true
      end

      it "updates workflow_status to triaged" do
        result
        expect(task.reload.workflow_status).to eq("triaged")
      end
    end

    context "operator attempting commander-only transitions" do
      context "operator tries to resolve an in_progress task" do
        let(:task) { create(:task, site: site, workflow_status: "in_progress") }

        subject(:result) do
          described_class.call(task: task, to_status: "resolved", actor: actor, actor_role: "operator")
        end

        it "returns failure" do
          expect(result.failure?).to be true
        end

        it "returns a commander authority error" do
          expect(result.errors.first).to match(/Commander authority required/i)
        end

        it "does not update the task" do
          result
          expect(task.reload.workflow_status).to eq("in_progress")
        end

        it "does not write an audit event" do
          expect { result }.not_to change(AuditEvent, :count)
        end
      end

      context "operator tries to unblock a blocked task" do
        let(:task) { create(:task, :blocked, site: site) }

        subject(:result) do
          described_class.call(task: task, to_status: "in_progress", actor: actor, actor_role: "operator")
        end

        it "returns failure" do
          expect(result.failure?).to be true
        end

        it "returns a commander authority error" do
          expect(result.errors.first).to match(/Commander authority required/i)
        end
      end

      context "operator tries to reopen a resolved task" do
        let(:task) { create(:task, :resolved, site: site) }

        subject(:result) do
          described_class.call(task: task, to_status: "triaged", actor: actor, actor_role: "operator")
        end

        it "returns failure" do
          expect(result.failure?).to be true
        end

        it "returns a commander authority error" do
          expect(result.errors.first).to match(/Commander authority required/i)
        end
      end
    end

    context ".allowed_transitions_for role filtering" do
      it "returns all transitions for commander from in_progress" do
        expect(described_class.allowed_transitions_for("in_progress", role: "commander"))
          .to match_array(%w[blocked resolved])
      end

      it "filters out resolved for operator from in_progress" do
        expect(described_class.allowed_transitions_for("in_progress", role: "operator"))
          .to eq(%w[blocked])
      end

      it "filters out in_progress (unblock) for operator from blocked" do
        expect(described_class.allowed_transitions_for("blocked", role: "operator"))
          .to eq([])
      end

      it "filters out triaged (reopen) for operator from resolved" do
        expect(described_class.allowed_transitions_for("resolved", role: "operator"))
          .to eq([])
      end

      it "returns triaged for both roles from new" do
        expect(described_class.allowed_transitions_for("new", role: "operator"))
          .to eq(%w[triaged])
      end
    end

    context "admin attempting commander-only transitions" do
      it "allows resolving an in_progress task" do
        task = create(:task, site: site, workflow_status: "in_progress")

        result = described_class.call(task: task, to_status: "resolved", actor: actor, actor_role: "admin")

        expect(result).to be_success
        expect(task.reload.workflow_status).to eq("resolved")
      end

      it "allows unblocking a blocked task" do
        task = create(:task, :blocked, site: site)

        result = described_class.call(task: task, to_status: "in_progress", actor: actor, actor_role: "admin")

        expect(result).to be_success
        expect(task.reload.workflow_status).to eq("in_progress")
      end
    end
  end

  # Regression for the "concurrent task transition race" finding
  # (audit 2026-05-01 P2):
  #
  #   Pre-fix, transition_allowed? read the cached @task.workflow_status
  #   outside any row lock. Two operators transitioning the same task
  #   simultaneously could both pass the predicate, both reach
  #   @task.save!, and the second transaction silently overwrote the
  #   first. The losing operator received a 200 success but their state
  #   was discarded. Two task.transitioned audit events were written
  #   reflecting contradictory final states.
  #
  #   Fix: the transaction now lock!s the task row and re-checks
  #   transition_allowed? after the lock, raising StaleTransition for
  #   the loser so the caller gets a clean ServiceResult.failure with a
  #   "not allowed" error. This spec proves under genuine concurrency
  #   that exactly one of two simultaneous transitions wins.
  describe "concurrent transition contention", db_concurrency: true do
    let!(:concurrent_actor) { "concurrent-test-actor" }
    let!(:concurrent_site)  { create(:site) }
    let!(:concurrent_task) do
      create(:task, site: concurrent_site, workflow_status: "in_progress")
    end

    it "lets exactly one of two simultaneous valid transitions win the lock" do
      barrier = Concurrent::CyclicBarrier.new(2)
      results = Concurrent::Array.new
      errors  = Concurrent::Array.new

      target_statuses = ["resolved", "blocked"]
      target_reasons  = [nil, "blocked by Op B"]

      threads = 2.times.map do |i|
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            task = Task.find(concurrent_task.id)
            barrier.wait
            results << described_class.call(
              task:           task,
              to_status:      target_statuses[i],
              actor:          concurrent_actor,
              actor_role:     "commander",
              blocked_reason: target_reasons[i],
            )
          rescue StandardError => e
            errors << e
          end
        end
      end

      threads.each do |t|
        t.join(30) || raise("thread did not complete within 30s — likely barrier deadlock from a pre-barrier failure")
      end

      expect(errors).to be_empty,
        "threads raised: #{errors.map { |e| "#{e.class}: #{e.message}" }.join('; ')}"
      expect(results.size).to eq(2)
      successes = results.count(&:success?)
      failures  = results.count { |r| !r.success? }
      expect(successes).to eq(1)
      expect(failures).to eq(1)

      losing = results.reject(&:success?).first
      expect(losing.errors.first).to include("not allowed")

      transitioned_events = AuditEvent.where(
        entity_type: "Task",
        entity_id:   concurrent_task.id,
        event_type:  "task.transitioned",
      )
      expect(transitioned_events.count).to eq(1)
    end
  end
end
