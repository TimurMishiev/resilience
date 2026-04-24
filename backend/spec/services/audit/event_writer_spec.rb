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
end
