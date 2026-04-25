require "rails_helper"

RSpec.describe Audit::EventWriter do
  let(:actor) { create(:user, :commander) }
  let(:site)  { create(:site) }

  let(:base_attrs) do
    {
      actor: actor,
      entity_type: "Site",
      entity_id: site.id,
      event_type: "site.updated",
      action: "update",
      before_snapshot: { "name" => "Old Name" },
      after_snapshot: { "name" => "New Name" },
      correlation_id: SecureRandom.uuid,
    }
  end

  describe ".write" do
    it "creates an AuditEvent with all required attributes" do
      event = described_class.write(**base_attrs)

      expect(event).to be_persisted
      expect(event.schema_version).to eq(1)
      expect(event.actor).to be_present
      expect(event.entity_type).to eq("Site")
      expect(event.entity_id).to eq(site.id)
      expect(event.event_type).to eq("site.updated")
      expect(event.action).to eq("update")
      expect(event.before_snapshot).to eq("name" => "Old Name")
      expect(event.after_snapshot).to eq("name" => "New Name")
      expect(event.correlation_id).to eq(base_attrs[:correlation_id])
      expect(event.occurred_at).to be_within(2.seconds).of(Time.current)
    end

    it "stores optional metadata" do
      event = described_class.write(**base_attrs, metadata: { source: "test", rule_id: "abc" })

      expect(event.metadata).to include("source" => "test", "rule_id" => "abc")
    end

    it "allows nil metadata" do
      event = described_class.write(**base_attrs, metadata: nil)

      expect(event.metadata).to be_nil
    end

    it "allows nil before_snapshot for create actions" do
      event = described_class.write(
        **base_attrs.merge(
          event_type: "site.created",
          action: "create",
          before_snapshot: nil,
        ),
      )

      expect(event).to be_persisted
      expect(event.before_snapshot).to be_nil
    end

    it "creates an append-only record that is frozen after reload" do
      event = described_class.write(**base_attrs)
      reloaded = AuditEvent.find(event.id)

      # AuditEvent marks persisted records as readonly via after_initialize
      expect(reloaded).to be_readonly
    end

    it "raises ArgumentError when required keyword is missing" do
      expect {
        described_class.write(
          actor: actor,
          entity_type: "Site",
          entity_id: site.id,
          event_type: "site.updated",
          # after_snapshot deliberately omitted
          correlation_id: SecureRandom.uuid,
        )
      }.to raise_error(ArgumentError, /after_snapshot/)
    end

    it "propagates the correlation_id exactly" do
      custom_id = SecureRandom.uuid

      event = described_class.write(
        actor: actor,
        entity_type: "Site",
        entity_id: site.id,
        event_type: "site.updated",
        action: "update",
        before_snapshot: nil,
        after_snapshot: { "name" => "Test" },
        correlation_id: custom_id,
      )

      expect(event.correlation_id).to eq(custom_id)
    end

    it "sets occurred_at close to the current time" do
      event = described_class.write(**base_attrs)

      expect(event.occurred_at).to be_within(2.seconds).of(Time.current)
    end
  end

  describe "organization_id resolution" do
    it "resolves via DB lookup for an entity that still exists" do
      org = create(:organization)
      live_site = create(:site, organization: org)

      event = described_class.write(
        actor:          actor,
        entity_type:    "Site",
        entity_id:      live_site.id,
        event_type:     "site.updated",
        after_snapshot: { "name" => "x" },
        correlation_id: SecureRandom.uuid,
      )

      expect(event.organization_id).to eq(org.id)
    end

    it "falls back to before_snapshot organization_id when the entity has been destroyed" do
      # Simulates an audit write that follows a destroy inside the same
      # transaction: the DB lookup finds nothing, so the writer must
      # reach into before_snapshot to preserve tenant scoping. Without
      # this fallback the event would persist with organization_id=nil
      # and leak globally via events_controller's "unscoped event"
      # rule (events_controller.rb:88).
      org = create(:organization)
      doomed = create(:site, organization: org)
      snapshot_at_destroy = { "id" => doomed.id, "name" => doomed.name, "organization_id" => doomed.organization_id }
      doomed.destroy!

      event = described_class.write(
        actor:           actor,
        entity_type:     "Site",
        entity_id:       doomed.id,
        event_type:      "site.destroyed",
        action:          "destroy",
        before_snapshot: snapshot_at_destroy,
        after_snapshot:  { "destroyed" => true },
        correlation_id:  SecureRandom.uuid,
      )

      expect(event.organization_id).to eq(org.id)
    end

    it "falls back to a nested site organization_id in before_snapshot (e.g. destroyed task)" do
      org         = create(:organization)
      parent_site = create(:site, organization: org)
      task        = create(:task, site: parent_site)
      snapshot    = { "id" => task.id, "site" => { "id" => parent_site.id, "organization_id" => org.id } }
      task.destroy!

      event = described_class.write(
        actor:           actor,
        entity_type:     "Task",
        entity_id:       task.id,
        event_type:      "task.destroyed",
        action:          "destroy",
        before_snapshot: snapshot,
        after_snapshot:  { "destroyed" => true },
        correlation_id:  SecureRandom.uuid,
      )

      expect(event.organization_id).to eq(org.id)
    end

    it "returns nil when neither the DB lookup nor the snapshot carries an organization_id" do
      # Defence-in-depth check: we want the audit event to persist even
      # if resolution fails — losing the audit trail entirely would be
      # worse than losing the scoping. events_controller treats a nil
      # organization_id as a global event, which is a known and
      # documented gap for unscopable records.
      fake_id = SecureRandom.uuid

      event = described_class.write(
        actor:           actor,
        entity_type:     "Site",
        entity_id:       fake_id,
        event_type:      "site.destroyed",
        before_snapshot: { "name" => "orphan" },
        after_snapshot:  { "destroyed" => true },
        correlation_id:  SecureRandom.uuid,
      )

      expect(event).to be_persisted
      expect(event.organization_id).to be_nil
    end
  end

  describe "chain-of-custody (ADR-010)" do
    let(:org_a) { create(:organization) }
    let(:org_b) { create(:organization) }

    def write_event_for(org)
      described_class.write(
        actor:          actor,
        entity_type:    "Organization",
        entity_id:      org.id,
        event_type:     "org.touched",
        action:         "touch",
        after_snapshot: { "id" => org.id, "marker" => SecureRandom.hex(4) },
        correlation_id: SecureRandom.uuid,
      )
    end

    it "starts each org chain at chain_position 1 with the genesis sentinel as prev_hash" do
      first = write_event_for(org_a)

      expect(first.chain_position).to eq(1)
      expect(first.prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(org_a.id))
      expect(first.row_hash.bytesize).to eq(32)
      expect(first.hash_version).to eq(Audit::ChainHasher::HASH_VERSION)
    end

    it "links each subsequent row to the previous row's row_hash" do
      first  = write_event_for(org_a)
      second = write_event_for(org_a)
      third  = write_event_for(org_a)

      expect(second.chain_position).to eq(2)
      expect(third.chain_position).to eq(3)
      expect(second.prev_hash).to eq(first.row_hash)
      expect(third.prev_hash).to eq(second.row_hash)
    end

    it "isolates chains across organizations (each org's chain_position is independent)" do
      a1 = write_event_for(org_a)
      b1 = write_event_for(org_b)
      a2 = write_event_for(org_a)
      b2 = write_event_for(org_b)

      expect(a1.chain_position).to eq(1)
      expect(a2.chain_position).to eq(2)
      expect(b1.chain_position).to eq(1)
      expect(b2.chain_position).to eq(2)

      # Cross-org chains never reference each other's hashes.
      expect(a2.prev_hash).to eq(a1.row_hash)
      expect(b2.prev_hash).to eq(b1.row_hash)
      expect(a1.row_hash).not_to eq(b1.row_hash)
    end

    it "computes a row_hash that matches a fresh ChainHasher run over the persisted fields" do
      event = write_event_for(org_a)

      recomputed = Audit::ChainHasher.compute(
        hash_version:    event.hash_version,
        organization_id: event.organization_id,
        chain_position:  event.chain_position,
        prev_hash:       event.prev_hash,
        id:              event.id,
        schema_version:  event.schema_version,
        actor:           event.actor,
        entity_type:     event.entity_type,
        entity_id:       event.entity_id,
        event_type:      event.event_type,
        action:          event.action,
        correlation_id:  event.correlation_id,
        occurred_at:     event.occurred_at,
        sequence:        event.sequence,
        before_snapshot: event.before_snapshot,
        after_snapshot:  event.after_snapshot,
        metadata:        event.metadata,
      )

      expect(recomputed).to eq(event.row_hash)
    end

    it "maintains chain integrity under nested transactions" do
      # Caller wraps multiple writes in one transaction; the per-org
      # advisory lock is reentrant so the second write reads the first
      # write's tip without deadlocking.
      events = []
      ActiveRecord::Base.transaction do
        events << write_event_for(org_a)
        events << write_event_for(org_a)
        events << write_event_for(org_a)
      end

      expect(events.map(&:chain_position)).to eq([ 1, 2, 3 ])
      expect(events[1].prev_hash).to eq(events[0].row_hash)
      expect(events[2].prev_hash).to eq(events[1].row_hash)
    end

    it "writes unscoped (nil-org) events into the global chain with the global genesis sentinel" do
      first = described_class.write(
        actor:           actor,
        entity_type:     "Site",
        entity_id:       SecureRandom.uuid,
        event_type:      "site.destroyed",
        before_snapshot: { "name" => "orphan" },
        after_snapshot:  { "destroyed" => true },
        correlation_id:  SecureRandom.uuid,
      )

      expect(first.organization_id).to be_nil
      expect(first.chain_position).to eq(1)
      expect(first.prev_hash).to eq(Audit::ChainHasher.genesis_prev_hash(nil))
    end
  end
end
