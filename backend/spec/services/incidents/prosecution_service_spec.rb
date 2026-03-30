require 'rails_helper'

RSpec.describe Incidents::ProsecutionService, type: :service do
  include ActiveSupport::Testing::TimeHelpers
  let(:commander) { create(:user, :commander) }
  let(:operator)  { create(:user, :operator)  }
  let(:incident)  { create(:incident, status: "open") }

  # ── initiate ─────────────────────────────────────────────────────────────────

  describe "operation: :initiate" do
    def call(inc: incident, actor: commander, notes: nil)
      described_class.call(operation: :initiate, incident: inc, actor: actor, notes: notes)
    end

    it "returns success" do
      expect(call.success?).to be true
    end

    it "sets prosecution_phase to 'assessing'" do
      call
      expect(incident.reload.prosecution_phase).to eq "assessing"
    end

    it "sets prosecuted_by_id to the actor" do
      call
      expect(incident.reload.prosecuted_by_id).to eq commander.id
    end

    it "sets prosecution_initiated_at to a recent timestamp" do
      travel_to(Time.current) do
        call
        expect(incident.reload.prosecution_initiated_at).to be_within(1.second).of(Time.current)
      end
    end

    it "creates a prosecution step with action_type 'phase_transition'" do
      expect { call }.to change(ProsecutionStep, :count).by(1)
      step = ProsecutionStep.last
      expect(step.phase).to eq "assessing"
      expect(step.action_type).to eq "phase_transition"
      expect(step.actor).to eq commander
    end

    it "stores the optional notes on the step" do
      call(notes: "Initial assessment")
      expect(ProsecutionStep.last.notes).to eq "Initial assessment"
    end

    it "writes an audit event with event_type 'prosecution_started'" do
      expect { call }.to change(AuditEvent, :count).by(1)
      audit = AuditEvent.order(:occurred_at).last
      expect(audit.event_type).to eq "prosecution_started"
      expect(audit.entity_type).to eq "Incident"
      expect(audit.entity_id).to eq incident.id
      expect(audit.actor).to eq commander.email
    end

    it "broadcasts a prosecution_started SSE event" do
      broadcaster = Sse::Broadcaster.instance
      expect(broadcaster).to receive(:publish).with(
        event: "prosecution_started",
        data:  hash_including(incident_id: incident.id, prosecution_phase: "assessing")
      )
      call
    end

    context "when the incident is already being prosecuted" do
      before { call }

      it "returns failure" do
        expect(call.success?).to be false
      end

      it "includes a descriptive error" do
        result = call
        expect(result.errors.first).to match(/already being prosecuted/)
      end

      it "does not create an extra prosecution step" do
        expect { call }.not_to change(ProsecutionStep, :count)
      end
    end

    context "when the incident is resolved" do
      it "returns failure" do
        inc = create(:incident, status: "resolved", closed_at: Time.current)
        result = described_class.call(operation: :initiate, incident: inc, actor: commander)
        expect(result.success?).to be false
        expect(result.errors.first).to match(/resolved/)
      end
    end

    context "when the incident is closed" do
      it "returns failure" do
        inc = create(:incident, :closed)
        result = described_class.call(operation: :initiate, incident: inc, actor: commander)
        expect(result.success?).to be false
        expect(result.errors.first).to match(/closed/)
      end
    end

    it "rolls back incident update if step creation fails" do
      allow(ProsecutionStep).to receive(:create!).and_raise(ActiveRecord::RecordInvalid)
      expect { call }.not_to change { incident.reload.prosecution_phase }
    end
  end

  # ── add_step ─────────────────────────────────────────────────────────────────

  describe "operation: :add_step" do
    before do
      described_class.call(operation: :initiate, incident: incident, actor: commander)
    end

    def call(phase: "assessing", action_type: "note_added", notes: "A note", evidence_refs: {})
      described_class.call(
        operation:     :add_step,
        incident:      incident,
        actor:         commander,
        phase:         phase,
        action_type:   action_type,
        notes:         notes,
        evidence_refs: evidence_refs,
      )
    end

    it "returns success" do
      expect(call.success?).to be true
    end

    it "creates a prosecution step" do
      expect { call }.to change(ProsecutionStep, :count).by(1)
    end

    it "stores the notes and evidence_refs" do
      call(notes: "Observed pattern", evidence_refs: { "signal_ids" => ["s1"] })
      step = ProsecutionStep.order(:occurred_at).last
      expect(step.notes).to eq "Observed pattern"
      expect(step.evidence_refs["signal_ids"]).to eq ["s1"]
    end

    it "does not advance prosecution_phase when phase matches current" do
      call(phase: "assessing")
      expect(incident.reload.prosecution_phase).to eq "assessing"
    end

    it "advances prosecution_phase when stepping forward to executing" do
      call(phase: "executing", action_type: "phase_transition")
      expect(incident.reload.prosecution_phase).to eq "executing"
    end

    it "advances prosecution_phase through the full forward sequence" do
      call(phase: "executing",  action_type: "phase_transition")
      call(phase: "concluded", action_type: "outcome_recorded")
      expect(incident.reload.prosecution_phase).to eq "concluded"
    end

    it "returns failure when attempting a backward phase transition" do
      call(phase: "executing", action_type: "phase_transition")
      result = call(phase: "assessing", action_type: "note_added")
      expect(result.success?).to be false
      expect(result.errors.first).to match(/assessing/)
    end

    it "returns failure for an invalid phase" do
      result = call(phase: "targeting")
      expect(result.success?).to be false
      expect(result.errors.first).to match(/Invalid phase/)
    end

    it "returns failure for an invalid action_type" do
      result = call(action_type: "redact")
      expect(result.success?).to be false
      expect(result.errors.first).to match(/Invalid action_type/)
    end

    it "returns failure when incident is not being prosecuted" do
      fresh = create(:incident)
      result = described_class.call(
        operation:   :add_step,
        incident:    fresh,
        actor:       commander,
        phase:       "assessing",
        action_type: "note_added",
        notes:       "note",
      )
      expect(result.success?).to be false
      expect(result.errors.first).to match(/not being prosecuted/)
    end

    it "writes an audit event with event_type 'prosecution_step_added'" do
      expect { call }.to change(AuditEvent, :count).by(1)
      audit = AuditEvent.order(:occurred_at).last
      expect(audit.event_type).to eq "prosecution_step_added"
    end

    it "broadcasts a prosecution_step_added SSE event" do
      broadcaster = Sse::Broadcaster.instance
      expect(broadcaster).to receive(:publish).with(
        event: "prosecution_step_added",
        data:  hash_including(incident_id: incident.id)
      )
      call
    end

    it "rolls back on step save failure without changing prosecution_phase" do
      described_class.call(
        operation: :add_step, incident: incident, actor: commander,
        phase: "executing", action_type: "phase_transition", notes: nil
      )
      allow(ProsecutionStep).to receive(:create!).and_raise(ActiveRecord::RecordInvalid)
      phase_before = incident.reload.prosecution_phase
      described_class.call(
        operation: :add_step, incident: incident, actor: commander,
        phase: "concluded", action_type: "outcome_recorded", notes: nil
      )
      expect(incident.reload.prosecution_phase).to eq phase_before
    end
  end

  # ── unknown operation ─────────────────────────────────────────────────────────

  describe "unknown operation" do
    it "returns failure" do
      result = described_class.call(operation: :unknown, incident: incident, actor: commander)
      expect(result.success?).to be false
      expect(result.errors.first).to match(/Unknown operation/)
    end
  end
end
