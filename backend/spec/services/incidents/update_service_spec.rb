require "rails_helper"

RSpec.describe Incidents::UpdateService do
  let(:actor)    { create(:user, :commander) }
  let(:incident) { create(:incident, title: "Original", severity: "low") }

  describe "updating attributes" do
    it "updates title and severity" do
      result = described_class.call(
        incident: incident,
        params: { "title" => "Updated", "severity" => "high" },
        actor: actor,
      )

      expect(result).to be_success
      expect(result.payload[:incident].title).to eq("Updated")
      expect(result.payload[:incident].severity).to eq("high")
    end

    it "writes an audit event with before/after snapshots" do
      expect {
        described_class.call(
          incident: incident,
          params: { "title" => "New Title" },
          actor: actor,
        )
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("incident_updated")
      expect(event.before_snapshot["title"]).to eq("Original")
      expect(event.after_snapshot["title"]).to eq("New Title")
    end
  end

  describe "parameter filtering" do
    it "ignores non-permitted fields" do
      result = described_class.call(
        incident: incident,
        params: { "title" => "Safe", "status" => "closed" },
        actor: actor,
      )

      expect(result).to be_success
      expect(result.payload[:incident].status).to eq("open")
    end

    it "returns success with no changes when params are empty" do
      result = described_class.call(
        incident: incident,
        params: {},
        actor: actor,
      )

      expect(result).to be_success
    end
  end

  describe "validation errors" do
    it "returns failure for invalid severity" do
      result = described_class.call(
        incident: incident,
        params: { "severity" => "cosmic" },
        actor: actor,
      )

      expect(result).not_to be_success
      expect(result.errors).to be_present
    end
  end
end
