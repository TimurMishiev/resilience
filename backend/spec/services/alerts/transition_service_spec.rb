require "rails_helper"

RSpec.describe Alerts::TransitionService do
  before do
    allow(Sse::Broadcaster.instance).to receive(:publish)
  end

  let(:actor)  { create(:user, role: "commander") }
  let(:match)  { create(:signal_rule_match) }

  # ── Valid transitions ──────────────────────────────────────────────────────

  describe "valid transitions" do
    it "transitions unacknowledged → acknowledged" do
      result = described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("acknowledged")
    end

    it "transitions unacknowledged → investigating (skip step)" do
      result = described_class.call(match: match, to_status: "investigating", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("investigating")
    end

    it "transitions unacknowledged → closed (direct dismiss)" do
      result = described_class.call(match: match, to_status: "closed", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("closed")
    end

    it "transitions acknowledged → investigating" do
      match.update!(workflow_status: "acknowledged")
      result = described_class.call(match: match, to_status: "investigating", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("investigating")
    end

    it "transitions investigating → closed" do
      match.update!(workflow_status: "investigating")
      result = described_class.call(match: match, to_status: "closed", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("closed")
    end

    it "re-opens a closed alert → investigating" do
      match.update!(workflow_status: "closed")
      result = described_class.call(match: match, to_status: "investigating", actor: actor)
      expect(result.success).to be true
      expect(match.reload.workflow_status).to eq("investigating")
    end

    it "returns the updated match in the payload" do
      result = described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(result.payload[:match]).to eq(match)
    end
  end

  # ── Actor + timestamp recording ────────────────────────────────────────────

  describe "actor and timestamp recording" do
    it "sets acknowledged_by to the acting user" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(match.reload.acknowledged_by).to eq(actor)
    end

    it "sets acknowledged_at to approximately now" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(match.reload.acknowledged_at).to be_within(2.seconds).of(Time.current)
    end

    it "overwrites acknowledged_by on subsequent transitions" do
      operator = create(:user, role: "operator")
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      described_class.call(match: match, to_status: "investigating", actor: operator)
      expect(match.reload.acknowledged_by).to eq(operator)
    end
  end

  # ── Notes ──────────────────────────────────────────────────────────────────

  describe "notes" do
    it "stores operator notes on the match" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor,
                           notes: "Confirmed GPS jamming in sector 7")
      expect(match.reload.notes).to eq("Confirmed GPS jamming in sector 7")
    end

    it "stores nil notes when none provided" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(match.reload.notes).to be_nil
    end

    it "overwrites previous notes on the next transition" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor, notes: "First note")
      described_class.call(match: match, to_status: "investigating", actor: actor, notes: "Updated note")
      expect(match.reload.notes).to eq("Updated note")
    end
  end

  # ── Invalid transitions ────────────────────────────────────────────────────

  describe "invalid transitions" do
    it "rejects an unknown status" do
      result = described_class.call(match: match, to_status: "pending", actor: actor)
      expect(result.success).to be false
      expect(result.errors.first).to include("not a valid alert status")
    end

    it "rejects a disallowed state jump (e.g. closed → acknowledged)" do
      match.update!(workflow_status: "closed")
      result = described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(result.success).to be false
      expect(result.errors.first).to include("cannot transition")
    end

    it "rejects transitioning to the same status" do
      result = described_class.call(match: match, to_status: "unacknowledged", actor: actor)
      expect(result.success).to be false
      expect(result.errors.first).to include("cannot transition")
    end

    it "does not update the match on failure" do
      expect {
        described_class.call(match: match, to_status: "invalid_state", actor: actor)
      }.not_to change { match.reload.workflow_status }
    end
  end

  # ── SSE broadcast ──────────────────────────────────────────────────────────

  describe "SSE broadcast" do
    it "publishes an alert_transitioned event after a successful transition" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        event: "alert_transitioned",
        data:  hash_including(
          id:              match.id,
          workflow_status: "acknowledged",
          acknowledged_by: actor.email
        )
      )
    end

    it "includes confidence and site context in the broadcast" do
      described_class.call(match: match, to_status: "acknowledged", actor: actor)
      expect(Sse::Broadcaster.instance).to have_received(:publish).with(
        hash_including(data: hash_including(:confidence, :site_name, :rule_name))
      )
    end

    it "does not broadcast on a failed transition" do
      described_class.call(match: match, to_status: "invalid", actor: actor)
      expect(Sse::Broadcaster.instance).not_to have_received(:publish)
    end
  end

  describe "audit trail" do
    it "writes an audit event for a successful transition" do
      expect {
        described_class.call(match: match, to_status: "acknowledged", actor: actor, notes: "Confirmed by watch officer")
      }.to change(AuditEvent, :count).by(1)

      event = AuditEvent.last
      expect(event.event_type).to eq("alert.transitioned")
      expect(event.entity_type).to eq("SignalRuleMatch")
      expect(event.entity_id).to eq(match.id)
      expect(event.before_snapshot).to include(
        "workflow_status" => "unacknowledged",
        "acknowledged_by_id" => nil,
        "notes" => nil,
      )
      expect(event.after_snapshot).to include(
        "workflow_status" => "acknowledged",
        "acknowledged_by_id" => actor.id,
        "notes" => "Confirmed by watch officer",
      )
      expect(event.metadata).to include(
        "from_status" => "unacknowledged",
        "to_status" => "acknowledged",
      )
    end

    it "does not write an audit event for an invalid transition" do
      expect {
        described_class.call(match: match, to_status: "invalid", actor: actor)
      }.not_to change(AuditEvent, :count)
    end
  end

  # ── allowed_transitions_for class method ──────────────────────────────────

  describe ".allowed_transitions_for" do
    it "returns correct transitions from unacknowledged" do
      expect(described_class.allowed_transitions_for("unacknowledged"))
        .to match_array(%w[acknowledged investigating closed])
    end

    it "returns correct transitions from acknowledged" do
      expect(described_class.allowed_transitions_for("acknowledged"))
        .to match_array(%w[investigating closed unacknowledged])
    end

    it "returns correct transitions from investigating" do
      expect(described_class.allowed_transitions_for("investigating"))
        .to match_array(%w[closed acknowledged])
    end

    it "returns correct transitions from closed" do
      expect(described_class.allowed_transitions_for("closed"))
        .to match_array(%w[investigating unacknowledged])
    end

    it "returns an empty array for an unrecognised status" do
      expect(described_class.allowed_transitions_for("unknown")).to eq([])
    end
  end
end
