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

    # Defends the chain-determinism contract: the scope must order
    # deterministically even when several events share the same occurred_at.
    # Without an explicit .order clause, Postgres iteration order is undefined
    # and replay state reconstruction can drift between identical inputs.
    it "orders results by sequence so same-occurred_at events return in deterministic chain order" do
      fixed = 1.hour.ago.change(usec: 0)
      e1 = create(:audit_event, occurred_at: fixed)
      e2 = create(:audit_event, occurred_at: fixed)
      e3 = create(:audit_event, occurred_at: fixed)

      results = described_class.up_to(Time.current).to_a

      expect(results).to include(e1, e2, e3)
      sequences = results.map(&:sequence)
      expect(sequences).to eq(sequences.sort)
    end
  end

  # ── Chain determinism under burst writes ────────────────────────────────────
  #
  # Direct proof that Audit::EventWriter produces a sound chain even when many
  # writes happen at the same `Time.current`. Closes OVL-2 from the joint
  # 2026-05-01 audit. Uses Audit::EventWriter.write (not the factory) because
  # only the writer builds a real hash chain — the factory's chain_position /
  # prev_hash / row_hash columns are random placeholders for non-chain tests.
  describe "chain determinism under same-occurred_at burst writes" do
    let(:org) { create(:organization) }
    let(:fixed_time) { Time.current.change(usec: 0) }

    it "produces a monotonic chain_position and validly-linked prev_hash chain" do
      travel_to(fixed_time) do
        5.times do |i|
          Audit::EventWriter.write(
            actor: "burst-test@example.com",
            entity_type: "Site",
            entity_id: SecureRandom.uuid,
            event_type: "burst.test",
            before_snapshot: nil,
            after_snapshot: { i: i },
            correlation_id: SecureRandom.uuid,
            organization_id: org.id,
          )
        end
      end

      events = AuditEvent
        .where(organization_id: org.id, event_type: "burst.test")
        .order(:chain_position)
        .to_a

      expect(events.size).to eq(5)
      # Chain position is monotonic from the org's existing tip; we only
      # assert that the deltas between consecutive rows are 1 (chain is
      # tight) rather than that the absolute values are 1..5, because the
      # advisory-lock-protected nextval may be perturbed by other test
      # data. The hash-link assertion below is the real proof of soundness.
      events.each_cons(2) do |earlier, later|
        expect(later.chain_position - earlier.chain_position).to eq(1)
      end

      # All five share the same occurred_at (the determinism scenario).
      expect(events.map(&:occurred_at).uniq.size).to eq(1)

      # Hash-chain integrity: each prev_hash must match the previous row_hash.
      events.each_cons(2) do |earlier, later|
        expect(later.prev_hash).to eq(earlier.row_hash)
      end

      # Every row's row_hash must match a fresh ChainHasher recomputation.
      events.each do |event|
        attrs = event.attributes.symbolize_keys.except(:row_hash, :created_at, :updated_at)
        expect(Audit::ChainHasher.compute(attrs)).to eq(event.row_hash)
      end
    end
  end
end
