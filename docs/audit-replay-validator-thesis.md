# Provenance is one invariant

**Audit chain, replay projection, and LLM validation are the same idea
applied at three layers.**

---

Operational systems fail in surprisingly similar ways. A commander clicks
an alert that doesn't exist anymore. A report cites a site that was
deleted last week. A language model suggests escalating an incident that
was closed an hour ago. The surface symptoms look different — a stale
link, a broken citation, a hallucinated reference — but they're the
same defect. **Every reference in the system, regardless of who
produced it, must trace to a real row at a real time.**

That sentence is the invariant. Once you accept it as a single
property the system has to maintain, three patterns collapse into one
architectural decision.

The audit chain proves the past was real. The replay projection
reconstructs the present from that past. The LLM validator proves AI
output against both. They look like three different problems to three
different teams. They are one problem solved in three places.

This essay describes the design of each layer in a system I built —
[Resilience](https://github.com/TimurMishiev/resilience), an operations
console — but the patterns aren't specific to that codebase. They are
the shape any system claiming chain-of-custody, deterministic replay,
and AI-output safety has to converge on.

---

## Layer 1: The past must be verifiable — audit chain of custody

The first layer is provenance for things that already happened.

A naive audit table is just an `INSERT` log: every state change writes
a row with a timestamp, an actor, and a snapshot. That tells you *what
the system claims happened*. It does not tell you *whether anyone
tampered with the claim*. A compromised admin, a raw-SQL bypass, or a
subtly buggy migration can rewrite history without leaving a fingerprint.

The audit chain closes this gap. Every row in the audit table carries
a `prev_hash` (a SHA-256 of the previous row's canonical encoding) and
a `row_hash` (a SHA-256 of *this* row's canonical encoding plus the
prev_hash). The first row in each organization's chain references a
deterministic genesis sentinel — `sha256("audit_chain_genesis:org:<id>")`
— so an attacker can't forge the chain head either. A verifier walks
the chain in `chain_position` order, recomputes every row_hash, and
flags the first position where the computed hash differs from the
stored one. **Tampering becomes detectable at the exact row where it
occurred.**

Three details matter. First, the canonical encoding is *versioned*.
The hash recipe is `HASH_VERSION = 1`; rows store their version with
the hash so a future canonicalization change (better key ordering, a
cleaner time format) bumps to v2 without invalidating history. Old
rows hash under their stored version, new ones under the current
default. The verifier is forward-compatible by design.

Second, the chain is serialized by a *per-organization* Postgres
advisory lock. Concurrent writes to the same org wait their turn;
concurrent writes across different orgs run in parallel. The lock
auto-releases when the surrounding transaction commits, so the model
fields (`chain_position`, `prev_hash`, `row_hash`) are computed and
persisted atomically with the rest of the row. There is no window
where the chain is inconsistent.

Third — and this is the detail most designs get wrong — the
deterministic-ordering tie-break uses a `bigserial` (`sequence`), not
a UUIDv4 primary key. Under a same-microsecond burst of writes,
`occurred_at DESC` ties; UUIDv4 has no temporal ordering, so picking
the "later" event by id is undefined. The bigserial increments
monotonically per insert, so `occurred_at DESC, sequence DESC` always
picks the actual later write. Without this, two-thread concurrency
specs pass at the "no row was lost" level but fail at the "the chain
resolves the same way twice in a row" level — and that subtle gap is
what an interviewer or a postmortem would catch.

DB-level immutability triggers reject `UPDATE` and `DELETE` regardless
of who issues them. Even if Ruby's `readonly!` is bypassed, even if
someone runs raw SQL, the trigger fires. This is defence-in-depth: the
chain is the cryptographic proof, the trigger is the operational
guard, and the verifier sweep is the periodic auditor. You only need
one to detect tampering, but you have three.

---

## Layer 2: The present must reconstruct from the past — replay projection

The second layer is provenance for what's true *now*.

Audit events tell you what happened. Most systems stop there: they show
a history view, they let you grep for a correlation_id, they call it
"audit logging" and move on. But the same data that proves the past
has another use — it can reconstruct any past *state*. If every
mutation writes through the audit chain with `before_snapshot` and
`after_snapshot` payloads, then for any entity at any point in time
you can ask: *what was the state of this row at `as_of`?*

The replay projection answers that. For a given `entity_type`,
`entity_id`, and `as_of` timestamp, it selects the latest audit event
for that entity at or before that time, and returns its
`after_snapshot`. Entities with no events before `as_of` are excluded
— they didn't exist yet. The query is `DISTINCT ON (entity_id) ...
ORDER BY entity_id, occurred_at DESC, sequence DESC`. Same tie-break
as the audit chain itself: `sequence DESC` makes concurrent
same-instant writes resolve to the same row every time the projection
runs. **The reconstruction is deterministic.**

Determinism is the contract. Two requests against the same `as_of`,
issued by different users on different threads on different servers,
get byte-identical responses. This is what makes a "replay mode" UI
trustworthy — the commander reviewing a 6-hour-old incident sees
exactly what the on-shift commander saw at the time, not "approximately
the same thing." The system tells the same story twice.

The projection is also a pure read: no side effects, no cache
invalidation, no replay-only mutations. The same code path that
returns *current* state with `as_of=now` returns *past* state with
`as_of=2026-04-15T14:00:00Z`. The frontend doesn't have a "replay
codepath" to maintain in parallel; replay is a query parameter, not a
feature flag. This collapses two systems into one.

The rest of the application participates by lifting `as_of` into a
context and propagating it through every API call. Mutations during
replay are rejected at the controller boundary — *replay is read-only
by design*. The whole system inherits the reconstruction guarantee
without any individual feature having to know about it.

---

## Layer 3: AI output must trace to both — the LLM validator

The third layer is provenance for outputs the system didn't write
itself.

Treat language models as untrusted input. They produce structured
recommendations against operational data — "escalate Incident X,"
"close stale alert Y," "assign Asset Z to Task W" — and every one of
those references is a place the model can hallucinate. A confident-
sounding recommendation can cite an incident that doesn't exist, an
alert that was closed last week, or an asset assigned to a different
mission. The first reaction is "validate the IDs exist." That's
necessary but not sufficient.

The trust boundary has four checks, applied in order:

1. **Primary entity exists.** The recommendation's
   `affected_entity_type` and `affected_entity_id` must resolve to a
   real row in the matching ActiveRecord model.

2. **Evidence items exist.** Every cited evidence row (sites,
   incidents, alerts, tasks, assets) must exist in the live database.
   This catches "the model cites an alert that was closed three days
   ago" — the kind of hallucination that survives a casual sanity
   check because the model's prose is internally coherent.

3. **Action payload IDs exist.** Recommendations carry an executable
   payload with operation-specific keys (`alert_id`, `incident_id`,
   `site_id`, etc.). Each ID in the payload must exist in the matching
   class — not just the primary entity. An LLM can pass checks 1 and
   2 while carrying a hallucinated ID in the payload that the
   ExecutorService will then act on.

4. **Cross-entity coherence — the payload target must match the
   surfaced entity.** This is the check most designs miss until they
   see the bug class. An LLM produces a recommendation displayed
   against Incident A while the executable payload references Incident
   B. Both incidents exist, both pass checks 1, 2, and 3 — but the
   operator clicks "execute" and the system acts on the wrong
   incident. The mismatch is invisible in the UI; the only place to
   catch it is the trust boundary, before the recommendation is
   persisted. The check enforces that for each recommendation type,
   the payload's target ID matches the surfaced entity's ID, and the
   surfaced entity type is in the type's allowed-surface set
   (`escalate_incident` requires `Incident`; `close_stale_alert`
   accepts either `Incident` or `SignalRuleMatch`, since both are
   legal UIs).

What makes the validator architecturally interesting isn't the four
checks individually — it's that **they reduce to the same invariant
the audit chain and replay projection enforce**. Every entity
reference must trace to a real row at a real time. The LLM's output
goes through the same provenance gate as everything else; the
validator just spells out the gate explicitly because the producer is
not trustworthy.

---

## One invariant, three places

When you put the three layers next to each other, the pattern is
visible:

- The **audit chain** says: *every claim about the past must trace to
  an immutable row whose hash chains to the previous one.*
- The **replay projection** says: *every claim about the present must
  reconstruct deterministically from the rows that prove the past.*
- The **LLM validator** says: *every claim made by an external
  producer must trace to a real row that the audit chain proves and
  the replay projection can reconstruct.*

These are the same sentence with different subjects. The system's
guarantees compound: anything the audit chain admits is replayable;
anything replayable is checkable; anything checkable is safe to act
on. The invariant moves from "we have an audit log" (most systems)
through "we can reconstruct past state" (good systems) to "AI output
inherits the same provenance guarantees as human-written data" (the
property that makes AI integration trustworthy in operational
settings).

The cost of treating provenance as one invariant rather than three
features is mostly upfront. You write the chain canonicalization
carefully because you'll lean on it forever. You make the replay
query deterministic because half your application reads it. You teach
the validator to check coherence because the LLM is just another
producer subject to the rule.

The benefit is that all three layers fail in the same direction. When
something goes wrong — an incident disappears, a recommendation cites
a closed alert, a replay tab disagrees with another tab — the
investigation always lands at the audit chain. There's one source of
truth, one place to look, one invariant to verify. **Operational
trust collapses into a single property the system either has or
doesn't.**

That property is what every operational system claiming chain-of-
custody, deterministic replay, or AI-assisted decision support
eventually has to converge on. The patterns above describe one way
to get there cleanly, but the destination is the same regardless of
the path: every reference in the system traces to a real row at a
real time, no matter who put it there.

---

## What this is not

This essay is not a scaling story. The chain serializes per-org
writes; under genuinely high-throughput multi-org load you may want
sharded chains or a queued-write architecture. It's also not a
replacement for transaction boundaries — the chain proves a row was
written; it does not prove the surrounding business invariants are
sound. And the LLM validator is not a correctness proof for model
reasoning; it catches hallucinated references, not bad judgment. Each
layer is necessary but none is sufficient on its own.

What it is, is one architectural commitment, applied three times,
that turns "trust me, the data is right" into "here is the proof,
identical for every layer, including the AI." That commitment is
worth making early. Once the invariant exists, every new feature
inherits it for free.

---

*Reference implementations of all three patterns live in
[`backend/app/services/audit/event_writer.rb`](../backend/app/services/audit/event_writer.rb),
[`backend/app/services/replay/projection_service.rb`](../backend/app/services/replay/projection_service.rb),
and
[`backend/app/services/recommendations/validator.rb`](../backend/app/services/recommendations/validator.rb).
The corresponding architecture decision records are
[ADR-001 (replay)](adr-001-server-side-replay.md),
[ADR-005 (AI trust boundary)](adr-005-ai-trust-boundary.md), and
[ADR-010 (audit chain of custody)](adr-010-audit-chain-of-custody.md).
Concurrency proofs at
[`backend/spec/models/audit_event_spec.rb`](../backend/spec/models/audit_event_spec.rb)
and
[`backend/spec/services/correlations/rule_firing_service_spec.rb`](../backend/spec/services/correlations/rule_firing_service_spec.rb)
exercise the chain and cooldown invariants under genuine two-thread
contention.*
