require "rails_helper"

RSpec.describe Task, type: :model do
  let(:site) { create(:site) }

  describe "resolved_at immutability" do
    context "when a task is resolved" do
      let(:task) do
        t = create(:task, site: site, workflow_status: "in_progress")
        t.update_columns(workflow_status: "resolved", resolved_at: 1.hour.ago)
        t.reload
      end

      it "prevents resolved_at from being changed — save returns false" do
        original = task.resolved_at
        task.resolved_at = Time.current
        expect(task.save).to be false
        expect(task.errors[:resolved_at]).to include("cannot be changed once set")
      end

      it "does not persist the new resolved_at" do
        original = task.resolved_at
        task.resolved_at = Time.current
        task.save
        expect(task.reload.resolved_at).to be_within(1.second).of(original)
      end
    end

    context "when resolved_at has never been set" do
      let(:task) { create(:task, site: site, workflow_status: "new") }

      it "allows resolved_at to be set for the first time" do
        task.workflow_status = "resolved"
        task.resolved_at     = Time.current
        expect(task).to be_valid
      end
    end
  end

  describe "blocked_reason consistency" do
    it "requires blocked_reason when status is blocked" do
      task = build(:task, site: site, workflow_status: "blocked", blocked_reason: nil)
      expect(task).not_to be_valid
      expect(task.errors[:blocked_reason]).to be_present
    end

    it "forbids blocked_reason when status is not blocked" do
      task = build(:task, site: site, workflow_status: "new", blocked_reason: "some reason")
      expect(task).not_to be_valid
      expect(task.errors[:blocked_reason]).to be_present
    end

    it "is valid with blocked_reason when blocked" do
      task = build(:task, :blocked, site: site)
      expect(task).to be_valid
    end
  end
end
