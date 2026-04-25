require "rails_helper"

RSpec.describe Audit::ChainHasher do
  let(:base_attrs) do
    {
      hash_version:    1,
      organization_id: "11111111-1111-1111-1111-111111111111",
      chain_position:  1,
      prev_hash:       described_class.genesis_prev_hash("11111111-1111-1111-1111-111111111111"),
      id:              "22222222-2222-2222-2222-222222222222",
      schema_version:  1,
      actor:           "user_3",
      entity_type:     "Site",
      entity_id:       "33333333-3333-3333-3333-333333333333",
      event_type:      "site.updated",
      action:          "update",
      correlation_id:  "44444444-4444-4444-4444-444444444444",
      occurred_at:     Time.utc(2026, 4, 24, 12, 0, 0),
      sequence:        100,
      before_snapshot: { "name" => "Old Name", "fields" => [ "a", "b" ] },
      after_snapshot:  { "name" => "New Name", "fields" => [ "a", "b" ] },
      metadata:        { "source" => "test" },
    }
  end

  describe ".compute" do
    it "returns a 32-byte digest (SHA-256 raw)" do
      expect(described_class.compute(base_attrs).bytesize).to eq(32)
    end

    it "is deterministic for the same input" do
      first  = described_class.compute(base_attrs)
      second = described_class.compute(base_attrs)
      expect(first).to eq(second)
    end

    it "produces a different digest when any field changes" do
      original = described_class.compute(base_attrs)

      [
        :id, :actor, :entity_id, :event_type, :action, :correlation_id,
        :sequence, :chain_position, :hash_version
      ].each do |field|
        mutated = base_attrs.merge(field => mutate_value(base_attrs[field]))
        expect(described_class.compute(mutated)).not_to eq(original),
          "expected hash to change when #{field} changes"
      end
    end

    it "is sensitive to nested snapshot mutations" do
      original = described_class.compute(base_attrs)

      mutated_after = base_attrs.merge(after_snapshot: { "name" => "New Name", "fields" => [ "a", "c" ] })
      expect(described_class.compute(mutated_after)).not_to eq(original)
    end

    it "is sensitive to occurred_at at microsecond precision" do
      original = described_class.compute(base_attrs)
      # Construct an explicit 1-microsecond shift instead of float-adding
      # 0.000001 (which loses precision at the boundary on some Ruby builds).
      shifted_time = Time.utc(2026, 4, 24, 12, 0, 0, 1)
      shifted      = base_attrs.merge(occurred_at: shifted_time)
      expect(described_class.compute(shifted)).not_to eq(original)
    end

    it "treats hashes with different key insertion order as equivalent" do
      reordered = base_attrs.merge(
        before_snapshot: { "fields" => [ "a", "b" ], "name" => "Old Name" },
        after_snapshot:  { "fields" => [ "a", "b" ], "name" => "New Name" },
      )
      expect(described_class.compute(reordered)).to eq(described_class.compute(base_attrs))
    end

    it "treats nil and absent metadata as equivalent" do
      with_nil    = base_attrs.merge(metadata: nil)
      with_absent = base_attrs.except(:metadata)
      expect(described_class.compute(with_nil)).to eq(described_class.compute(with_absent))
    end

    it "treats a Time and the same instant as a UTC string equivalently" do
      string_time = base_attrs.merge(occurred_at: "2026-04-24T12:00:00.000000Z")
      expect(described_class.compute(string_time)).to eq(described_class.compute(base_attrs))
    end
  end

  describe ".genesis_prev_hash" do
    it "returns a 32-byte digest" do
      expect(described_class.genesis_prev_hash("abc").bytesize).to eq(32)
    end

    it "is deterministic for a given organization_id" do
      org = SecureRandom.uuid
      expect(described_class.genesis_prev_hash(org)).to eq(described_class.genesis_prev_hash(org))
    end

    it "differs between two distinct organizations" do
      a = described_class.genesis_prev_hash(SecureRandom.uuid)
      b = described_class.genesis_prev_hash(SecureRandom.uuid)
      expect(a).not_to eq(b)
    end

    it "uses a distinct sentinel for unscoped (nil) chains" do
      org_genesis    = described_class.genesis_prev_hash("11111111-1111-1111-1111-111111111111")
      global_genesis = described_class.genesis_prev_hash(nil)
      expect(global_genesis).not_to eq(org_genesis)
    end
  end

  def mutate_value(v)
    case v
    when Integer then v + 1
    when String  then "#{v}_mutated"
    when nil     then "now_present"
    else "mutated"
    end
  end
end
