require "rails_helper"

RSpec.describe Assets::StatusChangeService do
  let(:asset) { create(:asset, status: "available") }
  let(:actor) { "commander@resilience.mil" }

  def call(to_status: "assigned")
    described_class.new(asset: asset, to_status: to_status, actor: actor).call
  end

  # ── Happy path ─────────────────────────────────────────────────────────────

  it "changes the asset status and returns success" do
    result = call(to_status: "assigned")
    expect(result.success?).to be true
    expect(asset.reload.status).to eq("assigned")
  end

  it "returns the updated asset in the result" do
    result = call(to_status: "offline")
    expect(result.asset.status).to eq("offline")
  end

  it "sets last_reported_at on success" do
    before = Time.current
    result = call(to_status: "assigned")
    expect(result.asset.last_reported_at).to be >= before
  end

  it "accepts all valid statuses" do
    Asset::STATUSES.each do |status|
      a = create(:asset, status: "available")
      next if status == "available"
      result = described_class.new(asset: a, to_status: status, actor: actor).call
      expect(result.success?).to be true
    end
  end

  it "writes an audit event with correct metadata" do
    expect { call(to_status: "degraded") }.to change(AuditEvent, :count).by(1)

    event = AuditEvent.last
    expect(event.event_type).to eq("asset.status_changed")
    expect(event.entity_type).to eq("Asset")
    expect(event.entity_id).to eq(asset.id)
    expect(event.actor).to eq(actor)
    expect(event.metadata["from_status"]).to eq("available")
    expect(event.metadata["to_status"]).to eq("degraded")
  end

  it "is atomic — rolls back if audit write fails" do
    allow(Audit::EventWriter).to receive(:write).and_raise(ActiveRecord::StatementInvalid)
    expect { call }.to raise_error(ActiveRecord::StatementInvalid)
    expect(asset.reload.status).to eq("available")
    expect(asset.reload.last_reported_at).to be_nil
  end

  # ── Failure cases ──────────────────────────────────────────────────────────

  it "fails with a clear error for an invalid status" do
    result = call(to_status: "destroyed")
    expect(result.success?).to be false
    expect(result.errors.first).to match(/not a valid asset status/)
  end

  it "fails when transitioning to the current status" do
    result = call(to_status: "available")
    expect(result.success?).to be false
    expect(result.errors.first).to match(/already in status/)
  end

  it "does not write an audit event on failure" do
    expect { call(to_status: "available") }.not_to change(AuditEvent, :count)
  end
end
