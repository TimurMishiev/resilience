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

    it "returns the latest snapshot for each entity even when one entity has a much longer history" do
      noisy_task = create(:task)
      quiet_task = create(:task)
      cutoff = Time.utc(2026, 4, 22, 12, 0, 0)

      150.times do |index|
        create(
          :audit_event,
          entity_type: "Task",
          entity_id: noisy_task.id,
          event_type: "task.transitioned",
          after_snapshot: { "workflow_status" => "noisy-#{index}" },
          occurred_at: cutoff - (300 - index).minutes,
        )
      end

      create(
        :audit_event,
        entity_type: "Task",
        entity_id: quiet_task.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "quiet-final" },
        occurred_at: cutoff - 5.minutes,
      )

      result = described_class.call(
        entity_type: "Task",
        entity_ids: [quiet_task.id, noisy_task.id],
        as_of: cutoff,
      )

      expect(result).to be_success
      expect(result.snapshots).to eq([
        { "workflow_status" => "quiet-final" },
        { "workflow_status" => "noisy-149" },
      ])
    end

    it "breaks ties on identical occurred_at via insertion-order sequence" do
      # Concurrent writes can produce two audit events with the same
      # microsecond occurred_at. The projection must return the LATER
      # insert deterministically, not a random UUID winner.
      #
      # Before the sequence column existed, ORDER BY id DESC picked an
      # arbitrary event because audit_events.id is gen_random_uuid().
      task   = create(:task)
      cutoff = 1.hour.ago.change(usec: 0)
      same_moment = cutoff - 5.minutes

      earlier = create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "earlier-insert" },
        occurred_at: same_moment,
      )
      later = create(
        :audit_event,
        entity_type: "Task",
        entity_id: task.id,
        event_type: "task.transitioned",
        after_snapshot: { "workflow_status" => "later-insert" },
        occurred_at: same_moment,
      )

      # Sanity: confirm the two events share the exact occurred_at (no
      # accidental drift through the factory).
      expect(earlier.occurred_at).to eq(later.occurred_at)
      # And that sequence increased monotonically at the DB layer.
      expect(later.reload.sequence).to be > earlier.reload.sequence

      result = described_class.call(
        entity_type: "Task",
        entity_ids: [task.id],
        as_of: cutoff,
      )

      expect(result).to be_success
      expect(result.snapshots).to eq([
        { "workflow_status" => "later-insert" },
      ])
    end
  end
end
