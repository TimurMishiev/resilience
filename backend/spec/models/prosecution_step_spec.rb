require 'rails_helper'

RSpec.describe ProsecutionStep, type: :model do
  subject(:step) { build(:prosecution_step) }

  # ── validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with default factory attributes" do
      expect(step).to be_valid
    end

    it "is invalid with a blank phase" do
      step.phase = ""
      expect(step).not_to be_valid
      expect(step.errors[:phase]).to be_present
    end

    it "is invalid with an unrecognised phase" do
      step.phase = "targeting"
      expect(step).not_to be_valid
      expect(step.errors[:phase]).to be_present
    end

    it "accepts all valid phases" do
      ProsecutionStep::VALID_PHASES.each do |phase|
        expect(build(:prosecution_step, phase: phase)).to be_valid
      end
    end

    it "is invalid with an unrecognised action_type" do
      step.action_type = "redact"
      expect(step).not_to be_valid
      expect(step.errors[:action_type]).to be_present
    end

    it "accepts all valid action_types" do
      ProsecutionStep::VALID_ACTION_TYPES.each do |at|
        expect(build(:prosecution_step, action_type: at)).to be_valid
      end
    end

    it "is invalid without occurred_at" do
      step.occurred_at = nil
      expect(step).not_to be_valid
    end
  end

  # ── evidence_refs schema ─────────────────────────────────────────────────────

  describe "evidence_refs schema validation" do
    it "accepts an empty hash" do
      step.evidence_refs = {}
      expect(step).to be_valid
    end

    it "accepts valid string-array values" do
      step.evidence_refs = { "signal_ids" => ["abc", "def"], "task_ids" => [] }
      expect(step).to be_valid
    end

    it "rejects a non-hash value" do
      step.evidence_refs = ["abc"]
      expect(step).not_to be_valid
      expect(step.errors[:evidence_refs]).to be_present
    end

    it "rejects a hash with non-array values" do
      step.evidence_refs = { "signal_ids" => "abc" }
      expect(step).not_to be_valid
      expect(step.errors[:evidence_refs]).to include(a_string_matching("signal_ids"))
    end

    it "rejects an array containing non-strings" do
      step.evidence_refs = { "signal_ids" => [123, 456] }
      expect(step).not_to be_valid
      expect(step.errors[:evidence_refs]).to include(a_string_matching("signal_ids"))
    end
  end

  # ── immutability ─────────────────────────────────────────────────────────────

  describe "immutability" do
    subject(:persisted_step) { create(:prosecution_step) }

    it "silently aborts on update (before_update throws :abort)" do
      original_notes = persisted_step.notes
      persisted_step.notes = "changed"
      result = persisted_step.save
      expect(result).to be false
      expect(persisted_step.reload.notes).to eq original_notes
    end

    it "does not raise on initial create" do
      expect { create(:prosecution_step) }.not_to raise_error
    end

    # Regression for the "ProsecutionStep destroy bypass" finding
    # (audit 2026-05-01 P2). The model claims append-only but pre-fix had
    # only a before_update guard. Incident#destroy with `dependent: :destroy`
    # would have silently nuked the prosecution log. Mirrors IncidentNote's
    # before_destroy guard at incident_note.rb:22-25.
    it "raises ReadOnlyRecord on destroy" do
      step = create(:prosecution_step)
      expect { step.destroy }.to raise_error(ActiveRecord::ReadOnlyRecord, /immutable/)
      expect(ProsecutionStep.exists?(step.id)).to be true
    end

    it "raises ReadOnlyRecord on destroy! (bang)" do
      step = create(:prosecution_step)
      expect { step.destroy! }.to raise_error(ActiveRecord::ReadOnlyRecord, /immutable/)
    end

    # Companion to the above: prove Incident now uses
    # restrict_with_exception so an attempt to destroy a parent Incident
    # with prosecution steps fails fast at the association edge rather
    # than colliding with the per-row before_destroy guard mid-cascade.
    it "blocks Incident#destroy when any prosecution_step is associated" do
      incident = create(:incident)
      create(:prosecution_step, incident: incident)
      expect { incident.destroy }
        .to raise_error(ActiveRecord::DeleteRestrictionError, /prosecution_steps/)
      expect(Incident.exists?(incident.id)).to be true
    end
  end

  # ── scopes ───────────────────────────────────────────────────────────────────

  describe ".for_incident" do
    it "returns steps for the given incident in occurred_at ascending order" do
      incident = create(:incident)
      step2 = create(:prosecution_step, incident: incident, occurred_at: 5.minutes.ago)
      step1 = create(:prosecution_step, incident: incident, occurred_at: 10.minutes.ago)
      create(:prosecution_step)  # different incident — should not appear

      expect(ProsecutionStep.for_incident(incident.id).to_a).to eq [step1, step2]
    end
  end
end
