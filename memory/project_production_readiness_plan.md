---
name: project_production_readiness_plan
description: Closeout record for the original production-readiness program plus subsequent CTO/audit-driven hardening
type: closeout
---

# Resilience — Production Readiness Closeout

Last reconciled with code: 2026-04-24

## Status

The original production-readiness program closed on 2026-04-09 against the
declared operating envelope (single-machine Fly.io, bounded SSE concurrency,
demo-scale tenant load). Three subsequent third-party reviews surfaced
**production-grade concerns the original program did not enumerate** —
those have now also been addressed and are listed in the *Post-Closeout
Hardening* section below.

What this file is **NOT** anymore: a claim that the system is "production
ready" in the universal sense (multi-region, high-concurrency, defence-tech
adversarial-resistant). What it IS: a record of the demo-grade posture the
original program targeted, plus the harder-bar fixes shipped after external
review reframed the scope.

Recalibrated framing per third-party CTO review (2026-04-24): the system is
"good enough for a public demo on a single Fly machine with a small handful
of concurrent operators." Production deployment at multi-tenant scale
requires the items in the *Open scale work* section below.

Future work now lives in `memory/project_roadmap.md`; ongoing debt /
program tracking lives in `memory/project_open_findings.md`.

## Source Of Truth Order

1. Actual code in the repo
2. `memory/project_roadmap.md`
3. `memory/project_open_findings.md`
4. This file
5. `memory/project_resilience.md`

If these disagree, prefer code first, then update memory.

## Closeout Summary

The production-readiness program closed with the following outcomes:

- Remaining replay surfaces were either made historically correct or explicitly accepted as live-only by product decision.
- Tenant and organization boundaries were documented, enforced, and tested consistently for the current product model.
- Security and identity controls were aligned across backend authorization and frontend UX for the current role/session model.
- The live transport ceiling was documented and accepted for the current single-machine Fly.io operating envelope.
- Core frontend hotspots were decomposed enough to make the main operational surfaces maintainable.
- Memory files were reconciled to reflect the completed production-readiness program.
- Final validation ran green:
  - backend full suite
  - frontend full suite
  - TypeScript
  - lint
  - security/static checks used by the repo
  - `git diff --check`

## What Shipped

### Replay Parity

The program delivered replay-correct or deliberately live-only behavior across the main operational surfaces:

- entity drawers, incidents, recommendations, alert triage, ontology query, briefing, site detail, dashboard, areas, correlation rules, and map/globe overlays all render historically safe read-only state during replay
- mission posture and supporting panels now honor replay-scoped AO/site state
- the remaining live-only exceptions are deliberate:
  - security/session inventory
  - operational health metrics
  - dashboard throughput analytics and loitering watchlist
  - rule-effectiveness analytics
  - configuration mutation paths during replay

### Tenant / Workspace Boundary

The current production tenant model is explicit and tested:

- org-owned operational and doctrine data is scoped by policy and request proof
- `ExternalSignal` and `Vessel` remain intentionally global intelligence domains
- org-null areas of operation are readable on the dedicated AO surface for eligible org-scoped users
- attached doctrine and operational records under those areas remain hidden or immutable unless a policy explicitly opts them into shared visibility
- AO-pinned users remain restricted to their selected AO

### Security / Identity

The program brought the app to a coherent production-grade baseline for the current role/session model:

- `viewer`, `operator`, `commander`, and `admin` roles are shipped
- scoped auth is fully enforced through Pundit
- session inventory, single-session revoke, sign-out-all, and admin cross-user session management are live
- frontend capability gating matches backend authorization on the protected surfaces covered by the program

### Live Transport / Operational Envelope

The current SSE transport was accepted and documented for the declared target:

- single-machine Fly.io deployment
- bounded concurrent SSE usage
- admission control enforced by lease-based caps and advisory locks
- thread-per-connection `ActionController::Live` accepted for this operating envelope

Replacing the transport is future scale work, not an unresolved production-readiness blocker.

### Frontend Maintainability

The program reduced the main maintainability hotspots enough for ongoing product work:

- `useGlobeEngine.ts`
- `useMapLibreEngine.ts`
- `PlanningPage.tsx`
- `GlobePage.tsx`
- `CorrelationRulesPage.tsx`
- `MapPage.tsx`
- `DashboardPage.tsx`

The remaining larger pages are no longer part of a production-readiness block; they are future decomposition candidates if velocity demands it.

## Final Validation Snapshot

The program was closed after the following repo-level checks ran green:

- backend full suite
- frontend full suite
- `npx tsc --noEmit`
- `npx eslint src`
- `bundle exec brakeman -q`
- `bundle exec bundler-audit check --update`
- `git diff --check`

## Post-Closeout Hardening (added 2026-04-24)

Three third-party reviews after the original closeout surfaced concerns
the program did not enumerate. Each was verified against actual code,
shipped, and locked with a regression spec:

- **F1 — SSE controller DB connection pinning** (`5bfbba5`).
  `ActionController::Live` held the controller's checked-out connection
  for the entire stream lifetime; ~25 concurrent streams would exhaust
  the prod pool of 25 and hard-block every other API request. Fixed
  via explicit `release_connection` before the loop and `with_connection`
  scoping for in-loop queries.
- **F3 — Silent incident-fusion data loss** (`0c8e3a8`). FusionService
  ran synchronously after the cooldown-claim transaction; a transient
  failure left the SignalRuleMatch orphaned forever. Now enqueues
  `Incidents::FusionJob` via SolidQueue with retry policy + dead-letter
  on exhaustion.
- **Login-CSRF defence-in-depth** (`c86727a`). Controller-layer Origin
  allowlist on `/api/auth/login` so a misconfigured Rack::Cors setting
  cannot silently widen the login surface.
- **pg_notify payload size guard** (`432badd`). Postgres' 8000-byte
  NOTIFY limit would fail silently in cross-machine relay; explicit
  guard returns false and surfaces to Observability instead.
- **CTO P0-P3 evaluation items** (commits `368e079` through `a395601`).
  Date.now defaults removed, globe operational parity, alert triage on
  globe inspector, inline debrief panel.
- **Audit findings Band A-D** (commits `327d7ca` through `b780ee4`).
  Telemetry SSE per-payload tenant scoping, recommendation
  per-tenant generation, correlation target-site three-branch
  resolution, briefing stale-response race, latency window
  reconciliation, RevokedJwt pruning, strong_migrations baseline.

## Accepted Caveats

The closeout claim — even with the post-closeout hardening — is still
scoped to the demo operating envelope:

- single-machine Fly.io deployment
- bounded SSE concurrency (now ~Puma thread budget rather than DB pool;
  thread-per-connection ceiling unchanged)
- current org/AO scoped tenant model, not a full workspace product
- in-memory Rack::Attack throttle store (single-machine only)
- single Anthropic provider with no eval harness (defensive integration,
  not agentic AI)

If any of those assumptions change, reopen the relevant future roadmap
tracks instead of treating this closeout as universally sufficient.

## Open Scale Work (NOT shipped — explicit roadmap items)

- ADR-002 horizontal-scaling implementation (Redis-backed throttles,
  ActionCable or out-of-process SSE, separate SolidQueue machine)
- Tenant-routed broadcaster (per-org channels) so high signal volume
  doesn't fan out to every connected client globally
- AI evals harness (golden tests, schema conformance, latency/cost
  dashboards)
- Trust-model rebuild (calibrated soft falloff, source-trust
  weighting, feedback loop on confirmed/rejected matches)
- Adversarial threat model + chain-of-custody event signing for
  defence-tech compliance

## Future Work Lives Elsewhere

- Active execution queue: `memory/project_roadmap.md`
- Ongoing platform debt / follow-through: `memory/project_open_findings.md`
- Historical broad context: `memory/project_resilience.md`
