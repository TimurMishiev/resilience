# Portfolio Guide — for Hiring Evaluators

This document is for reviewers evaluating Resilience as portfolio evidence
for a staff / principal engineering role at Palantir, Anduril, Reveal
Technology, Shield AI, or similar defense-tech shops. It exists because
the README is exhaustive (by design) but doesn't tell you where to
spend your time.

Pick the budget that fits:

---

## 5-Minute Tour — Is this worth a longer look?

1. Open the live demo: **<https://resilience-ops.fly.dev>**
   Credentials: `commander@resilience.mil` / `password123`
2. Click around for 60 seconds: Dashboard → Map → Globe → Incidents → Replay.
3. Open one file to confirm the code matches the demo:
   [`backend/app/services/audit/event_writer.rb`](backend/app/services/audit/event_writer.rb).

**What you're evaluating in 5 minutes:**
- Does the demo actually work end-to-end (map + globe + replay + AI)?
- Does the `EventWriter` code look like someone who understands transactional
  audit trails, or someone who wrapped `puts` in a service class?

If both answers are "yes," continue. If either is "no," you have enough
signal already.

---

## 15-Minute Tour — Evaluate the hardest problems

Read the [Reviewer's Guide section of the README](README.md#reviewers-guide--if-you-only-have-10-minutes).
Five deliberately-chosen files, each demonstrating a distinct staff-level
property:

1. **Audit trail with chain-of-custody** —
   `backend/app/services/audit/event_writer.rb` +
   `backend/app/services/audit/chain_hasher.rb` +
   `backend/app/services/audit/chain_verifier.rb`. Per-org SHA-256
   hash chain + DB-level immutability triggers + scheduled verifier
   sweep (ADR-010). Defence-in-depth: tampering survives Ruby
   readonly, fails on the trigger; trigger drop survives, fails on
   the chain.
2. **Atomic cooldown under concurrency** —
   `backend/app/services/correlations/rule_firing_service.rb`
   (and its paired spec, which proves the invariant, not just the happy path)
3. **Multi-tenant authorization with named helpers** —
   `backend/app/policies/application_policy.rb`
4. **AI trust boundary** — `backend/app/services/recommendations/validator.rb`
5. **Server-side replay engine** — `backend/app/services/replay/projection_service.rb`

Each file is ~2 minutes. None of them is representative-sample code; each
is the specific place where a hard problem got solved. If you only have
time for one, **pick #3** — the named-helper discipline is the single
cleanest demonstration of production-grade thinking on a topic where most
platforms get sloppy.

---

## 30-Minute Tour — Read the design, then the code

Engineers who can articulate their architecture are the ones worth hiring.
Five ADRs document the non-obvious design decisions:

- [ADR-001: Server-Side Replay via `as_of`](docs/adr-001-server-side-replay.md)
- [ADR-002: Horizontal Scaling Strategy](docs/adr-002-horizontal-scaling.md) *(Proposed, not yet implemented)*
- [ADR-003: Multi-Tenant Authorization via Named Boundary Helpers](docs/adr-003-multi-tenant-authorization.md)
- [ADR-004: Correlation Engine — Atomic Cooldown + Compound Discriminator](docs/adr-004-correlation-engine-atomic-cooldown.md)
- [ADR-005: AI Trust Boundary — Validator Pattern + Circuit Breaker](docs/adr-005-ai-trust-boundary.md)
- [ADR-006: Tenancy Contract — Documented Org/AO Scope Rules](docs/adr-006-tenancy-contract.md)
- [ADR-007: Connector Framework — 7-Feed Flat Shape, Framework Deferred](docs/adr-007-connector-framework.md)
- [ADR-008: Trust Model — Smooth Falloff + Source Reliability Priors](docs/adr-008-trust-model.md)
- [ADR-009: Adversarial Threat Model](docs/adr-009-adversarial-threat-model.md)
- [ADR-010: Audit Chain of Custody — Hash Chain + DB-Level Immutability](docs/adr-010-audit-chain-of-custody.md)

Each ADR has a "**What this is NOT**" section. Read those first if you're
looking for honesty signals. They're where I name scope limits that would
normally get silently elided in a portfolio artifact (e.g., ADR-004
explicitly says "not a CEP engine"; ADR-005 explicitly says "not a
correctness proof for model reasoning").

If you want to run the tests yourself:

```bash
git clone https://github.com/TimurMishiev/resilience.git
cd resilience
docker compose up                         # seeds demo data, opens localhost:3000
# In another shell:
cd backend && bundle exec rspec           # 2,312 examples against PostGIS
cd frontend && npx vitest run             # 678 tests across 91 files
```

---

## 60-Minute Tour — Understand the operator story

The code above answers *"is this engineer staff-level?"* The demo below
answers *"does this system do anything real?"*

Use the live demo with the commander account. Do this sequence:

1. **Dashboard** — KPIs, readiness bars, recent alerts.
2. **Map** — click a site, click an asset, notice the cross-entity
   highlighting. Click a signal, watch the evidence-linked sites
   light up. Toggle replay mode (top-right); the map shows historical state.
3. **Incidents** — open any incident. Walk the 5-tab workspace:
   Evidence → Tasks → Recommendations → Notes → History. The History tab
   is the full audit trail — every mutation, before/after snapshot, actor,
   correlation ID.
4. **Correlation Rules** — build a compound rule (AND between two signal
   types), dry-run it against historical signals, save.
5. **AI Briefing** — ask for a briefing on any site. Notice that every
   entity reference the model cites resolves to a real record (see ADR-005
   for why). Requires an `ANTHROPIC_API_KEY` — the live demo does not have
   one configured, so run locally to exercise this surface:
   `ANTHROPIC_API_KEY=sk-ant-... docker compose up`.
6. **Replay** — set a past timestamp. Sites, tasks, alerts, readiness
   scores, AO overlays, and the map view all reconstruct historical state.
   Mutations are disabled in replay (deliberately — replay is read-only).

---

## What this demonstrates about the engineer

Not exhaustive. The things a senior reviewer would actually write down
after looking at this code:

- **Systems thinking, not feature thinking.** The audit trail isn't bolted
  on — every mutation writes through it transactionally, and every row is
  hash-chained with DB-level immutability triggers (ADR-010) so a
  compromised admin or a raw-SQL bypass is detected, not silently
  trusted. The replay system isn't a feature — it's a property of the
  data model. The authorization boundary isn't a policy — it's a helper
  discipline that every policy consumes. These are architectural
  commitments, not feature checkboxes.

- **Concurrency correctness as a native concern.** The atomic cooldown
  claim (ADR-004), the `RecordNotUnique` rescue in `IngestService`, the
  monotonic-token guard in `DebriefPanel` are patterns that only matter
  under real load. Building them preemptively is a production-experience
  signal.

- **AI treated as an untrusted-input category.** The `Validator`'s four
  checks (ADR-005) aren't written by someone who trusts LLMs. They're
  written by someone who's seen hallucinated references cause bad
  operator decisions.

- **Test quality over test count.** 2,312 backend specs and 678 frontend
  tests, but what matters is what they prove: org-isolation specs,
  scoped-access request specs, concurrency-invariant specs for the rule
  engine, adapter-level engine tests for the map/globe, role-boundary E2E
  scenarios. These aren't "does it render" tests.

- **Shipping discipline.** See [CHANGELOG.md](CHANGELOG.md) for the arc:
  7 execution phases, a multi-audit remediation, four-priority CTO
  evaluation with reduced-scope judgment on the last item. Every phase
  closed cleanly before the next one opened.

---

## Honest weaknesses

A senior reviewer will find these before you do. Better to name them:

- **`MapPage.tsx` is 847 lines** with 29 `useState` + 31 `useCallback`. It
  grew across five geospatial-tool additions without a refactor pass. The
  extraction (`useActiveMapTool` + per-tool hooks) is documented in the
  CTO evaluation as P4 but is currently gated on a sixth tool being
  planned. The honest read: this engineer ships features fast but has a
  higher refactor-trigger threshold than I'd want at staff level.

- **ADR-002 (Horizontal Scaling) is still Proposed, not Accepted.** Single
  Fly machine today. The scaling architecture is designed but not
  implemented. If your role requires multi-region production ops on day
  one, this is a gap.

- **Map and Debrief are separate pages**, not a composable split
  workstation. The inline-debrief slice proves the cross-panel pattern but
  doesn't ship the full workstation. CTO P3's 5-slice variant is
  deliberately deferred pending usage signal.

- **No third-party integration experience visible.** This is a green-field
  portfolio project; there's no SAP/Salesforce/legacy-system integration
  story. If your role is heavy on enterprise-integration complexity, this
  code won't directly demonstrate that skill.

- **Single-engineer project.** Every discipline here is self-enforced.
  Some of the engineering debates that would happen in a team (code
  review pushback on `MapPage`'s size, for instance) never happened.
  That's visible in the code structure.

These are coaching points, not disqualifiers.

---

## What I'd want to talk about in an interview

Three conversation openers, in descending order of how much I'd enjoy them:

1. **The replay architecture.** `useReferenceTimeMs` → `as_of` →
   `ProjectionService` → `AuditSnapshotService`. I can whiteboard the
   full pipeline and explain why `Date.now()` inside a replay-gated
   component body would be incorrect even if the caller passed the right
   `as_of`.

2. **The authorization helpers.** Why `owned_area_of_operation_accessible?`
   and `area_of_operation_surface_accessible?` are two distinct named
   helpers and not one with a flag. (Answer: named variants force the
   caller to articulate intent at the call site; a flag lets callers
   mechanically pass a variable they don't think about.)

3. **What I'd do differently.** `MapPage` should have been refactored at
   tool 3, not tool 5. The `Date.now()` defaults on library functions
   were a convenience-over-safety tradeoff that shouldn't have existed in
   a codebase with a replay pipeline. The `MapSiteAlertsSection` component
   name is still `MapSite...` despite being reused on globe now — a
   rename deferred under scope discipline that I know should be paid down.

If any of those don't track, the hour we'd spend together probably
isn't productive for either of us.
