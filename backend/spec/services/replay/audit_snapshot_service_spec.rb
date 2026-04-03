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
  end
end
