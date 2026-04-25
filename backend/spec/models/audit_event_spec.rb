require "rails_helper"

RSpec.describe AuditEvent, type: :model do
  # ── Validations ─────────────────────────────────────────────────────────────

  describe "validations" do
    it "is valid with factory defaults" do
      expect(build(:audit_event)).to be_valid
    end

    %i[schema_version actor entity_type entity_id event_type after_snapshot correlation_id occurred_at].each do |field|
      it "requires #{field}" do
        record = build(:audit_event, field => nil)
        expect(record).not_to be_valid
        expect(record.errors[field]).to be_present
      end
    end
  end

  # ── Immutability ────────────────────────────────────────────────────────────

  describe "immutability" do
    it "becomes readonly when loaded from the database" do
      event = create(:audit_event)
      reloaded = AuditEvent.find(event.id)
      expect(reloaded).to be_readonly
    end

    it "cannot be updated once reloaded" do
      event = create(:audit_event)
      reloaded = AuditEvent.find(event.id)
      expect { reloaded.update!(actor: "changed") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    end

    # Defence-in-depth: even when Ruby's readonly! is bypassed, the
    # database-level trigger blocks the UPDATE/DELETE. update_columns
    # skips Rails' readonly check so it actually issues SQL.
    describe "DB-level triggers (ADR-010)" do
      let!(:event) { create(:audit_event) }

      it "blocks UPDATE at the trigger" do
        expect {
          event.update_columns(actor: "tampered")
        }.to raise_error(ActiveRecord::StatementInvalid, /audit_events are immutable/)
      end

      it "blocks DELETE at the trigger" do
        expect {
          AuditEvent.connection.execute(
            ActiveRecord::Base.send(:sanitize_sql_array,
              [ "DELETE FROM audit_events WHERE id = ?", event.id ])
          )
        }.to raise_error(ActiveRecord::StatementInvalid, /audit_events are append-only/)
      end
    end
  end

  # ── Scopes ──────────────────────────────────────────────────────────────────

  describe ".for_entity" do
    it "returns events for the given entity in chronological order" do
      entity_id = SecureRandom.uuid
      e1 = create(:audit_event, entity_type: "Task", entity_id: entity_id, occurred_at: 2.hours.ago)
      e2 = create(:audit_event, entity_type: "Task", entity_id: entity_id, occurred_at: 1.hour.ago)
      _other = create(:audit_event, entity_type: "Site", entity_id: SecureRandom.uuid)

      results = described_class.for_entity("Task", entity_id)
      expect(results).to eq([e1, e2])
    end
  end

  describe ".up_to" do
    it "returns events at or before the given timestamp" do
      cutoff = 1.hour.ago
      before = create(:audit_event, occurred_at: 2.hours.ago)
      at     = create(:audit_event, occurred_at: cutoff)
      after  = create(:audit_event, occurred_at: 10.minutes.ago)

      results = described_class.up_to(cutoff)
      expect(results).to include(before, at)
      expect(results).not_to include(after)
    end
  end
end
