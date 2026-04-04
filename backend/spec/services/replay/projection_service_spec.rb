require "rails_helper"

RSpec.describe Replay::ProjectionService, type: :service do
  describe ".call" do
    it "returns the last after_snapshot for each entity up to as_of" do
      task = create(:task)
      cutoff = 1.hour.ago.change(usec: 0)

      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.created",
        after_snapshot: { "workflow_status" => "new" },
        occurred_at: cutoff - 3.hours,
      )
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "blocked" },
        occurred_at: cutoff - 1.hour,
      )
      # After cutoff — should be excluded
      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "resolved" },
        occurred_at: cutoff + 1.hour,
      )

      result = described_class.call(entity_type: "Task", entity_ids: [task.id], as_of: cutoff)
      expect(result).to be_success
      expect(result.snapshots.length).to eq(1)
      expect(result.snapshots.first).to include("workflow_status" => "blocked")
    end

    it "excludes entities with no events before as_of" do
      task = create(:task)
      cutoff = 1.hour.ago.change(usec: 0)

      create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        after_snapshot: { "workflow_status" => "new" },
        occurred_at: cutoff + 1.hour,
      )

      result = described_class.call(entity_type: "Task", entity_ids: [task.id], as_of: cutoff)
      expect(result).to be_success
      expect(result.snapshots).to be_empty
    end

    it "handles multiple entities independently" do
      t1 = create(:task)
      t2 = create(:task)
      cutoff = Time.current

      create(:audit_event, entity_type: "Task", entity_id: t1.id,
             after_snapshot: { "title" => "Alpha" }, occurred_at: cutoff - 1.hour)
      create(:audit_event, entity_type: "Task", entity_id: t2.id,
             after_snapshot: { "title" => "Beta" }, occurred_at: cutoff - 30.minutes)

      result = described_class.call(entity_type: "Task", entity_ids: [t1.id, t2.id], as_of: cutoff)
      expect(result.snapshots.length).to eq(2)
    end

    it "returns empty snapshots for empty entity_ids" do
      result = described_class.call(entity_type: "Task", entity_ids: [], as_of: Time.current)
      expect(result).to be_success
      expect(result.snapshots).to eq([])
    end
  end
end
