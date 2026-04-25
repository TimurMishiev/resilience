# Changelog

A phase-level view of what shipped and why. This is not a per-commit list —
`git log` is authoritative for that. This document exists so a reviewer can
understand the shape of the work without reading the commit graph.

All dates are the close of the phase, not individual commits.

---

## Post-Phase-7 Remediation & CTO Evaluation Response — 2026-04 (current)

After Phase 7 closed, the work shifted from feature development to a
coordinated hardening sweep driven by two external inputs: a merged
multi-audit findings matrix, and a third-party CTO evaluation. Both were
worked through the confirmed-findings backlog before new features were
considered.

### Chain-of-custody on audit_events (ADR-010, 2026-04-25)

Closes the highest-leverage gap from ADR-009 (adversarial threat
model): every `audit_events` row is now hash-chained per organization
with SHA-256 + DB-level immutability triggers + a daily verifier
sweep + an admin-only on-demand endpoint.

- **Tranche A**: schema migration + `Audit::ChainHasher` + `EventWriter`
  wiring under per-org advisory locks.
- **Tranche B**: backfill via `Audit::ChainBackfiller` + NOT NULL
  enforcement + `prevent_audit_event_update` / `prevent_audit_event_delete`
  triggers (replacing the documentation-only claim from ADR-009).
- **Tranche C**: `Audit::ChainVerifier` + `Audit::VerifyAllChainsJob` +
  `GET /api/admin/audit_chain` (admin-only) + tamper-detection coverage
  for every break mode.
- **Tranche D**: ADR-010 design rationale + ADR-009 status flip.

### Portfolio Polish

- **Eight new ADRs** (`docs/adr-003…010`) documenting the subsystems
  the CTO evaluation called out as staff-level: multi-tenant
  authorization, correlation engine, AI trust boundary, tenancy
  contract, connector framework, trust model, adversarial threat
  model, and chain-of-custody.
- **README refresh** for hiring evaluators: badge strip, Reviewer's
  Guide section pointing at 5 specific files, stale test-count fixes.
- **This CHANGELOG** + [`PORTFOLIO.md`](PORTFOLIO.md) with tiered
  5/15/30/60-minute evaluator tours.

### CTO Evaluation — Third-Party Review

A third-party CTO evaluation scored the codebase 93/100 with a four-priority
path to 97. Each priority was independently verified against current code
(Step 0 before implementation) before being adopted. One priority (P3)
was adopted in reduced-scope form based on usage-signal reasoning; the
full variant is documented as a deferred decision.

- **P0** — `Date.now()` defaults removed from 6 shared library functions;
  live clock now threaded explicitly through every call site
  (`368e079`).
- **P1** — Globe operational-parity chain (4 slices):
  - Linked-entity cross-highlighting + `useReferenceTimeMs` threading (`402cd00`)
  - Evidence-linked site ring (`d93d897`)
  - Freshness-driven fill alpha on asset entities (`19c37e0`)
  - Signal-side evidence outline on PointPrimitives (`e2171e5`)
  - Plus two mentor-feedback refactors — shared fill-alpha curve
    (`e86d83c`), hoisted default-outline precompute (`6646db5`).
- **P2** — Alert triage section mounted inline in globe inspector
  (`23a722d`).
- **P3 (reduced-scope)** — Inline debrief panel on map (`a395601`).
  Full 5-slice workstation deferred pending operator-value signal;
  escalation and removal paths both documented.

### Audit Remediation Sweep

Four priority bands of confirmed findings, all closed.

- **Band D — Lower-Priority Hardening:** briefing panel stale-response
  race (F1), metrics latency window reconciliation (O1), JWT pruning
  job (J1), strong_migrations program (M1).
- **Band C — Multi-Tenant Readiness:** telemetry SSE per-payload tenant
  scoping (MT1), recommendation generation per-tenant loop (MT2),
  correlation target-site three-branch tenant resolution (MT3).
- **Band B — Trust & Historical Correctness:** GPSJam occurred-at
  semantics (I2), replay projection silent-truncation fix (R1).
- **Band A — Fix Before New Roadmap Work:** correlation-evaluator
  window alignment (I1), chokepoint truncation on map/globe (G1),
  invalid datetime handling in controller (API1), telemetry partition
  manager stale cache (D1).

---

## Phase 7 — Map Operator Tools — 2026-04-20 / 2026-04-21

Five geospatial tools added to `/map`, each session-local (no
persistence), each with explicit paint-order and style-swap tests.

- 7-1A: Measurement tool (distance + bearing)
- 7-1B: Temporary map annotations (labeled pins)
- 7-1C: Range rings (editable radii, NM/KM units)
- 7-1D: Bearing line / azimuth tool
- 7-1E: Sector / fan overlay

Plus a followup slice hardening shared geodesy helpers, replay `as_of`
fail-closed semantics, and full-fetch pagination rollout on map/globe/graph.

---

## Phase 6 — Globe Performance Benchmarking — 2026-04-19

Introduced a Playwright-based signal-reconcile benchmark against the
Dockerized production app. Per-tier CI gates at 1k/10k signal counts
(100k is report-only due to observed bimodal tail). Paint-completion
measurement via double-rAF; custom env overrides for CI re-anchoring.

Multi-run baseline established across 5 runs × 50 samples per tier
before gates were enabled, proving stability of the p95 invariant.

---

## Phase 5 — Evidence Threading — 2026-04-16 / 2026-04-17

Evidence-chain access surfaced across multiple operator surfaces.
`AlertChainDrawer` exposes the full rule-match → signal → site chain
with replay-aware stale-basis indicators.

- Slice 1: incident alert evidence access
- Slice 2-A: recommendation evidence access
- Slice 2-B: map alert evidence chain affordance
- Slice 2-C: stale-basis surfacing on alert evidence

---

## Phase 4 — Debrief Timeline + Click-to-Reconstruct — 2026-04-13 / 2026-04-15

Commander-only debrief timeline aggregating meaningful audit events.
Click-to-reconstruct workflow: any reconstructable event (Incident, Site,
Task, Asset) enters replay at the event's timestamp and navigates to the
entity's detail page with `as_of` threaded through.

- Slice 1: audit-events API prerequisites
- Slice 2: debrief entry + timeline
- Slice 3: click-to-reconstruct
- Slice 4a+4b: temporal diff surfaces + incident A/B compare
- Slice 4c: site compare

Monotonic click-token guard prevents stale in-flight lookups from
overwriting navigation when the operator clicks a newer row.

---

## Phase 3 — Spatial Analytics & Spatial Trust Rendering — 2026-04

Risk scoring composite (alert pressure + task health + signal density).
Chokepoint entity with status-colored overlays on both map and globe.
PostGIS spatial queries (`ST_DWithin`) replacing Haversine loops on the
hot path. Risk snapshots table for historical risk reconstruction.

---

## Phase 2 — Map Workstation & Triage-in-Context — 2026-04

Selection-first map. Click any site/asset/signal to open an inline
detail panel with live data and task transitions. Cross-entity selection
sync between map and globe (`?site_id=`, `?asset_id=`, `?signal_id=`).
Alert triage panel embedded in the map selection flow.

---

## Phase 1 — Trustworthy Operational Picture — 2026-04

Freshness model: `fresh | aging | stale | unavailable` derived from a
shared reference clock, rendered as opacity/color modulation on map
entities. Live SSE stream for asset telemetry with admission control
(`SseStreamLease` table + advisory lock, per-user and per-IP caps).
Operational Health surface exposing feed freshness, job health, and
relay liveness.

---

## Phase 0 — Execution Foundation — 2026-03 / 2026-04-10

Replay pipeline: `useReferenceTimeMs` at the page level, `as_of` query
param to the backend, `Replay::ProjectionService` reconstructing entity
state from audit events. Pundit policies on every controller with
`verify_authorized` after-action gate. Operational health background
jobs. PWA shell with offline caching. Classification banner support.

Seeded the execution package: `memory/execution_context.md` for durable
context, `memory/execution_handoff.md` for active handoff across
sessions.

---

## Earlier — Ingestion & Correlation — 2026-03 and prior

Initial feeds (USGS, OpenSky, AISHub, NASA FIRMS, GPSJam, GDACS, ACLED).
Correlation engine with atomic cooldown claim via `UPDATE ... WHERE`
row-lock. Compound (AND/OR) rules via operator-key discriminator — no
migration of legacy flat rules, coerced at read time via
`normalized_conditions`. Incident fusion, recommendation pipeline with
four-check validator. AI briefing + ontology query with circuit breaker
and scope isolation.

---

## How to read this

Each phase closed before the next opened. `memory/execution_handoff.md`
tracks the active slice at any point; `memory/execution_context.md`
tracks durable intent. The audit remediation sweep after Phase 7 was
triggered by two external inputs (merged audit findings + CTO eval) —
both were worked through completely before new feature work resumed.

For the code articulation of the hardest design decisions, see
[`docs/adr-001`…`adr-005`](docs/). For the evaluator tour, see
[`PORTFOLIO.md`](PORTFOLIO.md).
