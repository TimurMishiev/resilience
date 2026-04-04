require "rails_helper"

RSpec.describe Incidents::AssignService do
  let(:actor)    { create(:user, :commander) }
  let(:assignee) { create(:user, :operator) }
  let(:incident) { create(:incident) }

  describe "assigning" do
    it "assigns a user to the incident" do
      result = described_class.call(incident: incident, assignee: assignee, actor: actor)

      expect(result).to be_success
      expect(result.payload[:incident].assigned_to_id).to eq(assignee.id)
      expect(result.payload[:incident].assigned_at).to be_present
    end

    it "writes an audit event with assignee email" do
      expect {
        described_class.call(incident: incident, assignee: assignee, actor: actor)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("incident_assigned")
      expect(event.metadata["assignee_email"]).to eq(assignee.email)
    end
  end

  describe "unassigning" do
    let(:incident) { create(:incident, :assigned) }

    it "clears assignment when assignee is nil" do
      result = described_class.call(incident: incident, assignee: nil, actor: actor)

      expect(result).to be_success
      expect(result.payload[:incident].assigned_to_id).to be_nil
      expect(result.payload[:incident].assigned_at).to be_nil
    end

    it "writes audit event for unassignment" do
      expect {
        described_class.call(incident: incident, assignee: nil, actor: actor)
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.metadata["assignee_email"]).to be_nil
    end
  end

  describe "audit trail" do
    it "records before and after snapshots" do
      described_class.call(incident: incident, assignee: assignee, actor: actor)

      event = AuditEvent.last
      expect(event.before_snapshot["assigned_to_id"]).to be_nil
      expect(event.after_snapshot["assigned_to_id"]).to eq(assignee.id)
    end
  end
end
