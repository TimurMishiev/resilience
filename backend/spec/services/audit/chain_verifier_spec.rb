require "rails_helper"

# Audit::ChainVerifier walks an audit_events chain end-to-end and
# reports the first violation. Tampering tests bypass the immutability
# triggers via DISABLE TRIGGER (rolled back at end of transaction); in
# production, dropping a trigger would leave a forensic mark in the
# Postgres logs even before the verifier surfaced the resulting
# break.
RSpec.describe Audit::ChainVerifier do
  let(:org)   { create(:organization) }
  let(:org2)  { create(:organization) }
  let(:actor) { create(:user, :commander) }

  def write_event_for(organization, marker: SecureRandom.hex(4))
    Audit::EventWriter.write(
      actor:          actor,
      entity_type:    "Organization",
      entity_id:      organization.id,
      event_type:     "org.touched",
      action:         "touch",
      after_snapshot: { "id" => organization.id, "marker" => marker },
      correlation_id: SecureRandom.uuid,
    )
  end

  def with_audit_triggers_disabled
    conn = ActiveRecord::Base.connection
    conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_update")
    conn.execute("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_delete")
    yield
    # Re-enable not strictly necessary — transactional fixture rollback
    # restores DDL state — but we do it explicitly so a manual non-
    # transactional spec wouldn't leak state.
    conn.execute("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable_update")
    conn.execute("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable_delete")
  end

  describe ".verify_organization" do
    it "returns valid=true for an empty chain" do
      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(true)
      expect(v.rows_checked).to eq(0)
    end

    it "returns valid=true for a chain produced entirely via EventWriter" do
      3.times { write_event_for(org) }

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(true)
      expect(v.rows_checked).to eq(3)
      expect(v.broken_at).to be_nil
    end

    it "detects a tampered actor field at the row that was modified" do
      e1 = write_event_for(org)
      e2 = write_event_for(org)
      e3 = write_event_for(org)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e2.id).update_all(actor: "tampered")
      end

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(false)
      expect(v.broken_at).to eq(e2.chain_position)
      expect(v.reason).to match(/row_hash recomputation does not match/)
    end

    it "detects a tampered after_snapshot at the row that was modified" do
      e1 = write_event_for(org)
      e2 = write_event_for(org)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e2.id).update_all(
          after_snapshot: { "id" => org.id, "marker" => "totally_different" }
        )
      end

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(false)
      expect(v.broken_at).to eq(e2.chain_position)
      expect(v.reason).to match(/row_hash recomputation does not match/)
    end

    it "detects a missing chain link if a row's row_hash and prev_hash are forged inconsistently" do
      e1 = write_event_for(org)
      e2 = write_event_for(org)
      e3 = write_event_for(org)

      with_audit_triggers_disabled do
        # Replace e2.prev_hash with a sha256 of arbitrary bytes — chain
        # link to e1 is now broken even though e2's row_hash recomputation
        # would also fail; the verifier catches the prev_hash mismatch first.
        AuditEvent.unscoped.where(id: e2.id).update_all(
          prev_hash: Digest::SHA256.digest("forged")
        )
      end

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(false)
      expect(v.broken_at).to eq(e2.chain_position)
      expect(v.reason).to match(/prev_hash does not match previous row's row_hash/)
    end

    it "detects a tampered first row whose prev_hash no longer matches the genesis sentinel" do
      e1 = write_event_for(org)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e1.id).update_all(
          prev_hash: Digest::SHA256.digest("not_genesis")
        )
      end

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(false)
      expect(v.broken_at).to eq(1)
      expect(v.reason).to match(/first row prev_hash does not match genesis sentinel/)
    end

    it "detects a chain_position gap (a row was deleted)" do
      e1 = write_event_for(org)
      e2 = write_event_for(org)
      e3 = write_event_for(org)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e2.id).delete_all
      end

      v = described_class.verify_organization(org.id)
      expect(v.valid).to be(false)
      expect(v.broken_at).to eq(e3.chain_position)
      expect(v.reason).to match(/chain_position gap or reorder/)
    end

    it "isolates per-org chains — tampering in one org does not flag the other" do
      _e1 = write_event_for(org)
      e2  = write_event_for(org)
      _b1 = write_event_for(org2)
      _b2 = write_event_for(org2)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e2.id).update_all(actor: "evil")
      end

      bad  = described_class.verify_organization(org.id)
      good = described_class.verify_organization(org2.id)

      expect(bad.valid).to be(false)
      expect(good.valid).to be(true)
    end
  end

  describe ".verify_all" do
    it "returns one Verification per chain present in audit_events" do
      write_event_for(org)
      write_event_for(org2)

      results = described_class.verify_all
      org_ids = results.map(&:organization_id)
      expect(org_ids).to contain_exactly(org.id, org2.id)
      expect(results.map(&:valid)).to all(be(true))
    end

    it "reports valid=false on every chain that has a break, leaving valid chains alone" do
      e_org = write_event_for(org)
      _good = write_event_for(org2)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e_org.id).update_all(actor: "tampered")
      end

      results = described_class.verify_all
      bad     = results.find { |r| r.organization_id == org.id }
      good    = results.find { |r| r.organization_id == org2.id }

      expect(bad.valid).to be(false)
      expect(good.valid).to be(true)
    end
  end

  describe "Verification#to_h_serialisable" do
    it "hex-encodes binary expected/actual fields so the payload is JSON-safe" do
      e1 = write_event_for(org)

      with_audit_triggers_disabled do
        AuditEvent.unscoped.where(id: e1.id).update_all(actor: "tampered")
      end

      v        = described_class.verify_organization(org.id)
      payload  = v.to_h_serialisable

      expect(payload[:valid]).to be(false)
      expect(payload[:broken_at]).to eq(1)
      expect(payload[:expected]).to match(/\A[0-9a-f]{64}\z/)
      expect(payload[:actual]).to match(/\A[0-9a-f]{64}\z/)
    end
  end
end
