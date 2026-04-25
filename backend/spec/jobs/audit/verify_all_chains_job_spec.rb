require "rails_helper"

RSpec.describe Audit::VerifyAllChainsJob do
  let(:org)   { create(:organization) }
  let(:actor) { create(:user, :commander) }

  def write_event_for(organization)
    Audit::EventWriter.write(
      actor:          actor,
      entity_type:    "Organization",
      entity_id:      organization.id,
      event_type:     "org.touched",
      action:         "touch",
      after_snapshot: { "id" => organization.id, "marker" => SecureRandom.hex(4) },
      correlation_id: SecureRandom.uuid,
    )
  end

  it "records an OK status when every chain verifies cleanly" do
    write_event_for(org)
    write_event_for(org)

    described_class.new.perform

    status = OperationalStatus.find_by(category: "job_health", key: "audit_chain_integrity")
    expect(status).to be_present
    expect(status.payload["status"]).to eq("ok")
    expect(status.payload["chains"]).to be >= 1
    expect(status.payload["breaks_count"]).to eq(0)
    expect(status.payload).not_to have_key("breaks")
  end

  it "records an error status with break details when a chain is tampered" do
    e1 = write_event_for(org)
    _e2 = write_event_for(org)

    conn = ActiveRecord::Base.connection
    conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_update")
    AuditEvent.unscoped.where(id: e1.id).update_all(actor: "tampered")
    conn.execute("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable_update")

    described_class.new.perform

    status = OperationalStatus.find_by(category: "job_health", key: "audit_chain_integrity")
    expect(status.payload["status"]).to eq("error")
    expect(status.payload["breaks_count"]).to be >= 1
    expect(status.payload["breaks"]).to be_an(Array)

    breakdown = status.payload["breaks"].find { |b| b["organization_id"] == org.id }
    expect(breakdown["valid"]).to be(false)
    expect(breakdown["reason"]).to match(/row_hash recomputation/)
  end
end
