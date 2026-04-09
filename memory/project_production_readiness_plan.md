---
name: project_production_readiness_plan
description: Active execution plan for making Resilience production-ready before any new feature work
type: execution-plan
---

# Resilience — Production Readiness Plan

Last reconciled with code: 2026-04-09

## Mission

Make the existing product production-ready before starting any new feature roadmap work.

This file is the active execution source of truth for implementation sequencing.
If a proposed task is not part of production readiness, it is out of scope until this plan is complete.

## Hard Rule

- No new feature development until every active item in this file is either:
  - completed, or
  - explicitly reclassified as a deliberate non-goal.

Feature ideas may still be collected elsewhere, but they must not interrupt this plan.

## Source Of Truth Order

1. Actual code in the repo
2. This file
3. `memory/project_open_findings.md`
4. `memory/project_roadmap.md`
5. `memory/project_resilience.md`

If these disagree, prefer code first, then update memory.

## Definition Of Done

Resilience is not "production-ready" until all of the following are true:

- Remaining replay surfaces are either historically correct or explicitly live-only by product decision.
- Tenant and organization boundaries are documented, enforced, and tested consistently.
- Security and identity controls are coherent across backend authorization and frontend UX.
- Remaining operational ceilings are understood and documented, with the highest-risk ones mitigated.
- Main frontend hotspots are decomposed enough that core surfaces are maintainable under ongoing change.
- Memory files match reality and no longer describe already-closed gaps as open work.
- Full validation is green:
  - backend test suite
  - frontend test suite
  - TypeScript
  - lint
  - security/static checks used by the repo
  - `git diff --check`

## Active Workstreams

### 1. Replay Parity Completion

Goal: remove the remaining major "live-only during replay" correctness gaps.

Completed in the current local working tree:

- `frontend/src/components/EntityCard.tsx`
  - entity drawers now render historical read-only detail in replay instead of fail-closing
  - task / asset / site / AO detail hooks now thread `as_of`
  - asset and AO backend detail endpoints now support `as_of` on `index` / `show`
  - replay activity/raw tabs remain available

Still open:

- `frontend/src/pages/AreasPage.tsx`
  - AO configuration, posture, geometry, and rule membership are still fail-closed during replay.
- `frontend/src/pages/CorrelationRulesPage.tsx`
  - rule definitions, recent matches, and effectiveness are still fail-closed during replay.
- `frontend/src/pages/DashboardPage.tsx`
  - several widgets still hide during replay because they rely on live-only aggregates.
- `frontend/src/pages/SiteDetailPage.tsx`
  - risk trends and some site mutation/history surfaces remain live-only.
- `frontend/src/pages/MapPage.tsx`
- `frontend/src/pages/GlobePage.tsx`
  - AO/chokepoint/breach/live-vessel overlays still hide in replay.

Exit criteria:

- Each remaining replay-disabled surface is resolved one of two ways:
  - backend produces historical state and frontend renders it read-only, or
  - the product intentionally declares the surface live-only and documents why.

Priority order:

1. `AreasPage.tsx`
2. `CorrelationRulesPage.tsx`
3. `SiteDetailPage.tsx`
4. `DashboardPage.tsx`
5. Map/Globe overlay parity decisions

### 2. Tenant / Workspace Boundary Hardening

Goal: make the data-boundary model explicit, enforceable, and predictable.

Current reality:

- Org/AO scoping is materially implemented.
- Some domains remain intentionally global:
  - external signals
  - vessels
- Org-null areas are currently treated as globally visible.

Open questions that must be resolved:

- Is the product a strict tenant silo, or a scoped system with shared global intelligence domains?
- Are org-null areas truly intended to be global, or is that transitional behavior?
- What is the exact relationship between organization, AO, site, and user administration?

Execution tasks:

- Document the supported tenant model in code and memory.
- Audit remaining models/controllers/policies for ambiguity around global vs tenant-owned data.
- Add or expand request/policy proof anywhere the intended boundary is not already explicit.

Exit criteria:

- The tenant model can be described in one short paragraph without caveats.
- Policy scope behavior matches that description.
- Tests prove the intended boundary at both policy and request layers.

### 3. Security / Identity Maturity

Goal: move from "good app auth" to a more production-grade operational security model.

Already shipped:

- `viewer` / `operator` / `commander` / `admin`
- scoped auth
- session inventory
- single-session revoke
- sign out all sessions
- admin cross-user session management

Still open:

- clarify capability model beyond raw role names
- decide whether org admin and platform admin should remain the same role
- audit frontend gating for capability correctness, not just role-string checks
- review whether additional session/device metadata or controls are needed

Exit criteria:

- Role and capability expectations are explicit and consistent.
- Backend policy model and frontend gating reflect the same rules.
- No major user-visible 403 mismatches remain on protected surfaces.

### 4. Live Transport / Operational Ceiling Hardening

Goal: reduce the remaining operational risk in the live transport layer.

Current reality:

- SSE is much safer than before.
- Admission control, leases, and thread budgeting are real.
- Transport is still thread-per-connection via `ActionController::Live`.

Open work:

- decide whether the current transport is acceptable for the expected production scale
- if yes, document the ceiling and operational envelope clearly
- if no, define the redesign path instead of leaving it as ambient debt

Exit criteria:

- either:
  - the current SSE model is explicitly accepted and documented for target scale, or
  - a replacement path is chosen and scheduled as a deliberate follow-on program.

### 5. Frontend Maintainability / Decomposition

Goal: finish the remaining decomposition work where it still matters for velocity.

Already improved:

- `useGlobeEngine.ts`
- `useMapLibreEngine.ts`
- `PlanningPage.tsx`
- `GlobePage.tsx`
- `CorrelationRulesPage.tsx`

Still worth addressing:

- `frontend/src/pages/MapPage.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- any remaining page-level orchestration files that still mix:
  - replay gating
  - query wiring
  - selection sync
  - side-panel orchestration
  - render-time domain logic

Exit criteria:

- Remaining core surfaces are small enough to review as units.
- Page files are orchestration-first, not utility-heavy.

### 6. Memory / Validation / Final Gate

Goal: ensure the repo can be resumed by any agent without stale guidance.

Execution tasks:

- keep `memory/project_open_findings.md` aligned with actual open gaps
- keep `memory/project_roadmap.md` focused on future work, not active hardening
- keep this file updated after each major tranche:
  - completed
  - in progress
  - next
  - blocked
  - validation results

Final validation before declaring this program complete:

- backend full suite
- frontend full suite
- TypeScript
- lint
- repo security/static checks in normal CI
- `git diff --check`

## Current Execution Order

1. Replay parity completion
2. Tenant/workspace boundary clarification and hardening
3. Security/identity maturity cleanup
4. Remaining frontend decomposition
5. Final validation and memory reconciliation

## Working Session Handoff Format

Every future work session should update this file with:

- what was completed
- what is currently in progress
- what is next
- any blockers or environment notes
- exact validation that was run

That is the continuity mechanism for Codex, Claude, Gemini, or any future agent.

## Current Status

Completed:

- Production-readiness coordination files were created/aligned:
  - `memory/project_production_readiness_plan.md`
  - `memory/project_roadmap.md`
  - `memory/project_open_findings.md`
- Replay parity for `frontend/src/components/EntityCard.tsx`
  - asset / AO backend replay serializers and `as_of` handling were added
  - replay time is threaded through entity detail hooks
  - replay activity/raw tabs stay available
  - focused backend and frontend proof was added

In progress:

- Replay parity completion workstream

Next:

1. `frontend/src/pages/AreasPage.tsx`
2. `frontend/src/pages/CorrelationRulesPage.tsx`
3. `frontend/src/pages/SiteDetailPage.tsx`

Blocked / environment notes:

- Backend RSpec must be run with the local rbenv Ruby, not system Ruby.
- Supported local backend test path:
  - `source ~/.zshrc`
  - `cd backend`
  - `TEST_DATABASE_PORT=5434 bundle exec rspec ...`

Validation run for the current local EntityCard tranche:

- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/assets_spec.rb spec/requests/api/areas_of_operation_spec.rb`
- `npx vitest run frontend/src/test/EntityCard.test.tsx`
- `npx tsc --noEmit`
- `ruby -c backend/app/controllers/api/assets_controller.rb`
- `ruby -c backend/app/controllers/api/areas_of_operation_controller.rb`
- `git diff --check`
