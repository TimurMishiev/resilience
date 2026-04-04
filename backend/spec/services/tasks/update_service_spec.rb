require "rails_helper"

RSpec.describe Tasks::UpdateService do
  let(:actor) { create(:user, :commander) }
  let(:site)  { create(:site) }
  let(:task)  { create(:task, site: site, title: "Original", priority: "normal") }

  describe "commander updates" do
    it "updates title, description, and priority" do
      result = described_class.call(
        task: task,
        params: { "title" => "Updated", "description" => "New desc", "priority" => "high" },
        actor: actor,
        actor_role: "commander",
      )

      expect(result).to be_success
      expect(result.payload[:task].title).to eq("Updated")
      expect(result.payload[:task].priority).to eq("high")
    end

    it "writes an audit event" do
      expect {
        described_class.call(task: task, params: { "title" => "Changed" }, actor: actor, actor_role: "commander")
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("task.updated")
    end
  end

  describe "operator field restrictions" do
    it "allows title and description but strips priority" do
      result = described_class.call(
        task: task,
        params: { "title" => "Operator Title", "priority" => "critical" },
        actor: actor,
        actor_role: "operator",
      )

      expect(result).to be_success
      expect(result.payload[:task].title).to eq("Operator Title")
      expect(result.payload[:task].priority).to eq("normal") # unchanged
    end
  end

  describe "empty params" do
    it "returns failure when no updatable fields provided" do
      result = described_class.call(
        task: task,
        params: {},
        actor: actor,
        actor_role: "commander",
      )

      expect(result).not_to be_success
      expect(result.errors).to include("No updatable fields provided")
    end

    it "returns failure when only non-permitted fields provided" do
      result = described_class.call(
        task: task,
        params: { "status" => "closed" },
        actor: actor,
        actor_role: "operator",
      )

      expect(result).not_to be_success
    end
  end

  describe "posture-aware assignment" do
    let(:ao) { create(:area_of_operation, posture: "observe") }
    let(:site_with_ao) { create(:site, area_of_operation: ao) }
    let(:task_with_ao) { create(:task, site: site_with_ao) }
    let(:asset) { create(:asset, status: "available") }

    it "rejects assignment in observe posture" do
      result = described_class.call(
        task: task_with_ao,
        params: { "asset_id" => asset.id },
        actor: actor,
        actor_role: "commander",
      )

      expect(result).not_to be_success
      expect(result.errors.first).to include("Observe posture")
    end

    it "rejects non-available assets in defensive posture" do
      ao.update!(posture: "defensive")
      busy_asset = create(:asset, status: "assigned")

      result = described_class.call(
        task: task_with_ao,
        params: { "asset_id" => busy_asset.id },
        actor: actor,
        actor_role: "commander",
      )

      expect(result).not_to be_success
      expect(result.errors.first).to include("Defensive posture")
    end

    it "allows available assets in defensive posture" do
      ao.update!(posture: "defensive")

      result = described_class.call(
        task: task_with_ao,
        params: { "asset_id" => asset.id },
        actor: actor,
        actor_role: "commander",
      )

      expect(result).to be_success
    end

    it "allows any assignment in weapons_free posture" do
      ao.update!(posture: "weapons_free")
      busy_asset = create(:asset, status: "assigned")

      result = described_class.call(
        task: task_with_ao,
        params: { "asset_id" => busy_asset.id },
        actor: actor,
        actor_role: "commander",
      )

      expect(result).to be_success
    end
  end
end
