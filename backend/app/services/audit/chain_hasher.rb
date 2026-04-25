require "digest"
require "json"

module Audit
  # Deterministic, versioned hash function for ADR-010's chain-of-custody
  # contract on audit_events. Every persisted row carries:
  #
  #   - prev_hash: the row_hash of the previous row in this org's chain
  #                (or the genesis sentinel for chain_position = 1)
  #   - row_hash:  SHA-256 of the canonical encoding produced here
  #
  # A future verifier walks the chain in chain_position order, recomputes
  # row_hash for each row from its stored fields + the previous row's
  # row_hash, and compares against the stored row_hash. Tampering with any
  # field — or reordering, re-keying, or removing a row — produces a
  # mismatch the verifier flags with the exact chain_position that broke.
  #
  # The recipe is versioned (HASH_VERSION) so we can evolve canonicalisation
  # without invalidating historical rows. Old rows hash under their stored
  # hash_version; new rows under the current default.
  module ChainHasher
    HASH_VERSION = 1

    # Sentinel domain for the deterministic genesis prev_hash. Distinct
    # from any real Audit::EventWriter input so an attacker cannot forge a
    # legitimate chain head.
    GENESIS_DOMAIN = "audit_chain_genesis"

    module_function

    # Computes the row_hash for a fully-populated set of audit-event
    # attributes. Returns a 32-byte binary String suitable for direct
    # storage in the bytea column.
    #
    # The canonicalisation strategy is deliberately simple and auditable:
    #
    #   1. Build a Hash with a fixed key list and explicit ordering.
    #   2. Recursively canonicalise nested values:
    #      - Hashes → keys sorted lexicographically, recurse on values
    #      - Arrays → preserve order, recurse on elements
    #      - Times  → ISO8601 with 6-digit fractional seconds, UTC
    #      - everything else → leave to JSON.generate
    #   3. JSON.generate the result. Ruby's JSON emitter is stable for
    #      strings, integers, floats, true/false/nil — given a canonical
    #      key order, the byte output is deterministic on a given Ruby /
    #      stdlib version. Cross-version drift is mitigated by pinning
    #      HASH_VERSION; a future Ruby change in JSON formatting would
    #      bump to v2 with explicit migration.
    #   4. SHA-256 the UTF-8 bytes.
    def compute(attributes)
      payload = canonical_payload(attributes)
      json    = JSON.generate(payload)
      Digest::SHA256.digest(json)
    end

    # Returns the deterministic prev_hash that the FIRST row in an org's
    # chain (chain_position = 1) must reference. Reproducible from the
    # organization_id alone — a verifier can recompute it and confirm the
    # chain head was not forged.
    def genesis_prev_hash(organization_id)
      scope = organization_id.present? ? "org:#{organization_id}" : "global"
      Digest::SHA256.digest("#{GENESIS_DOMAIN}:#{scope}")
    end

    # Pure helper exposed for tests + the verifier. Do not call directly
    # from production paths; use .compute instead.
    def canonical_payload(attrs)
      {
        "hash_version"     => Integer(attrs.fetch(:hash_version)),
        "organization_id"  => attrs[:organization_id].presence,
        "chain_position"   => Integer(attrs.fetch(:chain_position)),
        "prev_hash_hex"    => attrs.fetch(:prev_hash).unpack1("H*"),
        "id"               => attrs.fetch(:id),
        "schema_version"   => Integer(attrs.fetch(:schema_version)),
        "actor"            => attrs.fetch(:actor).to_s,
        "entity_type"      => attrs.fetch(:entity_type).to_s,
        "entity_id"        => attrs.fetch(:entity_id).to_s,
        "event_type"       => attrs.fetch(:event_type).to_s,
        "action"           => attrs[:action].to_s,
        "correlation_id"   => attrs.fetch(:correlation_id).to_s,
        "occurred_at"      => format_time(attrs.fetch(:occurred_at)),
        "sequence"         => Integer(attrs.fetch(:sequence)),
        "before_snapshot"  => canonicalise(attrs[:before_snapshot]),
        "after_snapshot"   => canonicalise(attrs[:after_snapshot]),
        "metadata"         => canonicalise(attrs[:metadata]),
      }
    end

    def canonicalise(value)
      case value
      when nil   then nil
      when Hash  then value.sort.to_h.transform_values { |v| canonicalise(v) }
      when Array then value.map { |v| canonicalise(v) }
      when Time, DateTime then format_time(value)
      else value
      end
    end

    def format_time(value)
      time = value.is_a?(Time) ? value : Time.parse(value.to_s)
      time.utc.strftime("%Y-%m-%dT%H:%M:%S.%6N") + "Z"
    end
  end
end
