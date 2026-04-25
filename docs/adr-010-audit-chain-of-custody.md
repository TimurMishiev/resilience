# ADR-010: Audit Chain of Custody — Hash Chain + DB-Level Immutability

**Status:** Accepted (shipped 2026-04-25)
**Date:** 2026-04-25

## Context

ADR-009 (adversarial threat model) called out the absence of a
tamper-evident audit log as the highest-leverage gap for defence-tech
credibility, ranked priority 1 in the mitigation roadmap. Three
distinct review passes had flagged the same concern in different
language:

- *"What stops a compromised admin from rewriting the action log of
  their own session?"*
- *"Is `audit_events` actually append-only, or just append-by-
  convention?"*
- *"Chain-of-custody / provenance: how do we prove a row hasn't been
  modified after the fact?"*

Pre-ADR-010 state:

- `Audit::EventWriter` was the single chokepoint for audit writes.
- The `AuditEvent` model marked persisted records readonly via
  `after_initialize :freeze_if_persisted`.
- ADR-009 line 130-132 *claimed* `prevent_audit_event_updates` /
  `prevent_audit_event_deletes` migrations were in place, but that
  claim was documentation-only — no such migrations existed. A raw
  SQL session, a console mistake, or a compromised DB role with table
  privileges would all bypass the readonly flag.
- No way to detect tampering after the fact. If someone *did* rewrite
  a row, nothing flagged it.

## Decision

Two layered guarantees, both shipped:

1. **DB-level immutability triggers** — make UPDATE and DELETE on
   `audit_events` raise a Postgres-level exception. Closes the
   ADR-009 line 130-132 claim that was previously fictional.

2. **Per-organization SHA-256 hash chain** — each row carries a hash
   over its own contents and the previous row's hash, forming a chain
   that detects tampering even when an attacker has dropped the
   triggers.

The combination is defence-in-depth:

- **Tampering attempt 1** (UPDATE a row from app code): blocked by
  Ruby's `readonly!` flag. Raises `ActiveRecord::ReadOnlyRecord`.
- **Tampering attempt 2** (UPDATE via raw SQL bypassing Ruby): blocked
  by the `prevent_audit_event_update` trigger. Raises
  `ActiveRecord::StatementInvalid`.
- **Tampering attempt 3** (DELETE a row via raw SQL): blocked by the
  `prevent_audit_event_delete` trigger.
- **Tampering attempt 4** (`DROP TRIGGER ...; UPDATE ...`): the
  UPDATE succeeds, but the row's `row_hash` no longer matches a fresh
  `Audit::ChainHasher` recomputation, AND every downstream row's
  `prev_hash` no longer matches its predecessor. `Audit::ChainVerifier`
  reports the exact `chain_position` that broke. Dropping a trigger
  also leaves a forensic mark in the Postgres logs.

### Hash chain shape

Each row in `audit_events` carries:

- `chain_position` (bigint, NOT NULL, monotonic 1..N per chain)
- `prev_hash` (bytea, 32 bytes, NOT NULL)
- `row_hash` (bytea, 32 bytes, NOT NULL)
- `hash_version` (smallint, NOT NULL, default 1)

`row_hash = SHA-256(canonical_json(payload))` where `payload` is a
JSON object with sorted keys covering every column that matters for
forensic integrity — `id`, `actor`, `entity_type`, `entity_id`,
`event_type`, `action`, `before_snapshot`, `after_snapshot`,
`metadata`, `correlation_id`, `occurred_at` (microsecond UTC),
`sequence`, `organization_id`, `chain_position`, `prev_hash` (hex),
plus `hash_version`. Versioning lets us evolve the recipe without
invalidating historical rows.

`prev_hash` for the first row in each chain (`chain_position = 1`)
is a **deterministic genesis sentinel**:
`SHA-256("audit_chain_genesis:org:<id>")` for scoped chains, or
`SHA-256("audit_chain_genesis:global")` for the global nil-org chain.
A verifier can recompute the genesis from `organization_id` alone and
confirm the chain head was not forged.

### Per-organization chains, not global

Two unique partial indexes on `audit_events` enforce
"exactly one row per chain_position per chain":

```sql
CREATE UNIQUE INDEX idx_audit_events_chain_position_scoped
  ON audit_events (organization_id, chain_position)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX idx_audit_events_chain_position_unscoped
  ON audit_events (chain_position)
  WHERE organization_id IS NULL;
```

**Why per-org rather than a single global chain:**

- **Matches the tenancy contract** (ADR-006). Each organization's
  chain is verifiable independently — and a break in org A's chain
  does not contaminate org B's verification result.
- **Cross-org concurrency is unaffected.** Two writers in different
  orgs do not contend for the chain lock; only writers within the
  same org serialise.
- **Verification is incremental.** An operator can verify just the
  org being investigated rather than walk every row in the system.
- **Backfill is per-org.** Each chain can be reconstructed from a
  single org's rows ordered by `(occurred_at, sequence)` —
  consistent with the existing replay contract from ADR-001.

### Concurrency model

`Audit::EventWriter` takes a per-org Postgres advisory transaction
lock before reading the chain tip and writing the new row:

```ruby
key = hashtextextended("audit_chain:org:<id>", 0)
SELECT pg_advisory_xact_lock(key)
```

`pg_advisory_xact_lock` auto-releases when the surrounding
transaction commits or rolls back. The lock is reentrant, so callers
that wrap multiple writes in one transaction don't deadlock.

`id` (UUID) and `sequence` (bigserial) are pre-allocated with
`SecureRandom.uuid` + `nextval('audit_events_sequence_seq')`, so
every hash input is fully known before INSERT. We never UPDATE the
row to set the hash after INSERT — UPDATE is blocked by the
trigger.

### Verification

`Audit::ChainVerifier.verify_organization(org_id)` walks the chain in
`chain_position` order and reports the first violation it finds:

| Break mode | Reason string |
|---|---|
| `chain_position` gap (row deleted) | "chain_position gap or reorder" |
| First-row `prev_hash` ≠ genesis | "first row prev_hash does not match genesis sentinel" |
| `prev_hash` ≠ previous `row_hash` | "prev_hash does not match previous row's row_hash" |
| `row_hash` recomputation mismatch | "row_hash recomputation does not match stored value (row content tampered)" |

`.verify_all` iterates every chain present in `audit_events`. Returns
one Verification per chain.

### Operator surfaces

- **Daily scheduled sweep.** `Audit::VerifyAllChainsJob` runs every
  day at 02:45, recording the result to
  `OperationalStatus("job_health", "audit_chain_integrity")`. Chain
  breaks surface as a degraded job in the operator dashboard rather
  than as a buried log line.
- **On-demand admin endpoint.** `GET /api/admin/audit_chain` runs
  `verify_all` synchronously and returns the result. Admin-only
  (gated by `AuditChainPolicy#verify?`). Hex-encodes binary
  expected/actual values so the JSON payload is safe.
- **Console.** Operators responding to an incident can run
  `Audit::ChainVerifier.verify_organization(org_id)` directly —
  same code path the job and the controller use.

The verifier is **read-only**. It reports breaks, never auto-repairs.
Fixing a tampered row is an incident-response decision, not an
automatic action.

## What this is NOT

- **Not external attestation.** The chain is durable on a single
  Postgres instance; a sufficiently privileged DB admin who drops
  both triggers AND walks the entire chain rewriting every row's
  fields could produce a self-consistent forged chain. Closing this
  gap requires periodically committing the chain tip to an
  out-of-band durable store (a SIEM, a separate Postgres role-
  isolated table, or a third-party time-stamping service). Out of
  scope for the current portfolio shape.
- **Not a TRUNCATE guard.** TRUNCATE uses a separate trigger event
  (`BEFORE TRUNCATE`) that we deliberately don't install, because
  RSpec's transactional fixture cleanup occasionally relies on
  TRUNCATE in CI. Production-grade defence-tech deployment would add
  the truncation guard plus a Postgres role lacking TRUNCATE
  privilege.
- **Not a Merkle tree.** The chain is linear, not tree-shaped. A
  Merkle tree gives O(log n) inclusion proofs; the linear chain
  gives O(n) verification but O(1) writes and is simpler to reason
  about under concurrent load. Inclusion proofs are not part of the
  current operator workflow.
- **Not a cryptographic proof of liveness.** The chain proves
  *integrity* of recorded events, not *completeness* — an attacker
  who suppresses writes entirely (e.g., by tearing down EventWriter)
  produces an empty chain that verifies as valid. Detection of
  liveness gaps is a separate observability concern (rate alarms on
  audit_events INSERT volume).
- **Not calibrated for multi-million-row backfills.** The Tranche B
  backfill walks rows in Ruby; for a 10M+ row deployment this would
  need to be batched into chunks with periodic commits. The
  20260424220003 NOT NULL migration takes an `ACCESS EXCLUSIVE` lock
  long enough to scan the table — sub-second on the current ~100k
  scale, but would need the production-safe `ADD CONSTRAINT NOT VALID
  → VALIDATE → swap to NOT NULL` pattern at scale. Both are noted
  for future hardening; the direct form is honest about the current
  scale.

## Consequences

- **Code reviewers** know the audit log is forensically trustworthy
  end-to-end. A PR that touches `Audit::EventWriter` or any of the
  immutability triggers must reference this ADR.
- **Defence-tech acquirers** reading this ADR see the layered
  guarantee (Ruby readonly + DB triggers + hash chain + verifier +
  scheduled sweep) rather than a single-layer `readonly!` flag.
- **Operator incident response** has a concrete next step on chain
  break — re-run `Audit::ChainVerifier.verify_organization(org_id)`,
  inspect the row at `broken_at`, decide whether to roll back or
  declare a security incident.
- **Performance.** Per-org advisory locks serialise writes within an
  org but allow cross-org concurrency. SHA-256 over a typical row
  payload is sub-millisecond. Chain tip lookup is O(log N) via the
  composite unique index. Net write-path overhead is single-digit
  milliseconds.

## Related

- ADR-001 (server-side replay) — the chain hashes `occurred_at` at
  microsecond precision and `sequence` from the same column the
  projection's `DISTINCT ON ... ORDER BY (occurred_at, sequence)`
  uses. The chain order is consistent with the replay order.
- ADR-006 (tenancy contract) — chain scope mirrors the tenancy scope.
- ADR-009 (adversarial threat model) — item 1 of the mitigation
  roadmap is now shipped; this ADR is the implementation rationale.
