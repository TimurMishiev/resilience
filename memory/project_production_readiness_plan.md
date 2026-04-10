---
name: project_production_readiness_plan
description: Closeout record for the completed production-readiness program
type: closeout
---

# Resilience — Production Readiness Closeout

Last reconciled with code: 2026-04-10

## Status

The production-readiness program is complete as of 2026-04-09.

This file is no longer the active execution queue. It is preserved as a closeout record so future agents can understand what the production-readiness program covered, what it shipped, and which caveats were deliberately accepted for the current deployment target.

Future work now lives in `memory/project_roadmap.md`, and ongoing debt/program tracking lives in `memory/project_open_findings.md`.

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

## Accepted Caveats

The closeout claim is scoped to the current declared operating envelope:

- single-machine Fly.io deployment
- bounded SSE concurrency
- current org/AO scoped tenant model, not a full workspace-management product

If those assumptions change, reopen the relevant future roadmap tracks instead of treating this closeout as universally sufficient.

## Future Work Lives Elsewhere

- Active execution queue: `memory/project_roadmap.md`
- Ongoing platform debt / follow-through: `memory/project_open_findings.md`
- Historical broad context: `memory/project_resilience.md`
