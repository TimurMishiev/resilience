require "rails_helper"

RSpec.describe Replay::AuditSnapshotService, type: :service do
  describe ".call" do
    it "merges partial snapshots in event order" do
      task = create(:task, :resolved, title: "Current title")
      cutoff = 1.hour.ago.change(usec: 0)

      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        after_snapshot: {
          title: "Initial title",
          workflow_status: "new",
          blocked_reason: nil,
        },
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        after_snapshot: {
          workflow_status: "blocked",
          blocked_reason: "Awaiting approval",
        },
        occurred_at: cutoff - 1.hour,
      )

      result = described_class.call(entity_type: "Task", entity_ids: [task.id], as_of: cutoff)
      snapshot = result.snapshots.fetch(task.id)

      expect(snapshot["title"]).to eq("Initial title")
      expect(snapshot["workflow_status"]).to eq("blocked")
      expect(snapshot["blocked_reason"]).to eq("Awaiting approval")
    end

    it "preserves explicit nil values from later snapshots" do
      site = create(:site, flag_reason: "Current flag", flagged_at: Time.current)
      cutoff = 1.hour.ago.change(usec: 0)

      create(
        :audit_event,
        entity_type: "Site",
        entity_id: site.id,
        event_type: "site_flagged",
        after_snapshot: {
          flag_reason: "Legacy flag",
          flagged_at: cutoff - 2.hours,
        },
        occurred_at: cutoff - 2.hours,
      )
      create(
        :audit_event,
        entity_type: "Site",
        entity_id: site.id,
        event_type: "site_unflagged",
        after_snapshot: {
          flag_reason: nil,
          flagged_at: nil,
        },
        occurred_at: cutoff - 1.hour,
      )

      result = described_class.call(entity_type: "Site", entity_ids: [site.id], as_of: cutoff)
      snapshot = result.snapshots.fetch(site.id)

      expect(Replay::AuditSnapshotService.fetch(snapshot, "flag_reason")).to be_nil
      expect(Replay::AuditSnapshotService.fetch(snapshot, "flagged_at")).to be_nil
    end

    # Codex backlog #4 (2026-04-28): same-timestamp ordering must be
    # deterministic. Without a secondary sort by `sequence`, two events
    # for the same entity at the same `occurred_at` would fold in
    # database-dependent order, producing different replay state on
    # different calls — a real bug under burst load (multiple events
    # written in the same transaction or millisecond), and a
    # reproducibility hazard for any audit-driven snapshot consumer.
    it "deterministically orders same-timestamp events by sequence" do
      task = create(:task, :resolved, title: "Current title")
      cutoff = 1.hour.ago.change(usec: 0)
      shared_ts = cutoff - 30.minutes

      # Three events with IDENTICAL occurred_at. `sequence` is a
      # globally monotonic column written by EventWriter, so the order
      # of writes determines the order of replay. We exploit that here:
      # write in a deliberate sequence-order, then verify the snapshot
      # reflects the LAST-by-sequence write (not the last-by-row-order
      # or some non-deterministic ordering).
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task.transitioned",
             after_snapshot: { workflow_status: "new" },
             occurred_at: shared_ts)
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task.transitioned",
             after_snapshot: { workflow_status: "blocked" },
             occurred_at: shared_ts)
      create(:audit_event, entity_type: "Task", entity_id: task.id,
             event_type: "task.transitioned",
             after_snapshot: { workflow_status: "resolved" },
             occurred_at: shared_ts)

      # Run the call multiple times — without the sequence tiebreaker,
      # this would occasionally return a different last-write under
      # non-deterministic Postgres tuple ordering. With the fix the
      # last-by-sequence write ("resolved") wins every time.
      5.times do
        result = described_class.call(entity_type: "Task", entity_ids: [task.id], as_of: cutoff)
        snapshot = result.snapshots.fetch(task.id)
        expect(snapshot["workflow_status"]).to eq("resolved")
      end
    end
  end
end
