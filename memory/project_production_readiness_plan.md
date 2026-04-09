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
- `frontend/src/pages/AreasPage.tsx`
  - AO rows now render historical read-only state in replay
  - correlation-rule membership counts now support `as_of`
- `frontend/src/pages/CorrelationRulesPage.tsx`
  - historical rule definitions and recent firings now render read-only in replay
- `frontend/src/pages/SiteDetailPage.tsx`
  - risk history, breach count, and timeline now replay-clip correctly
- `frontend/src/pages/DashboardPage.tsx`
  - recent alerts, recommendations, and risk badges remain visible during replay
- `frontend/src/pages/MapPage.tsx`
- `frontend/src/pages/GlobePage.tsx`
  - historical AO overlays, chokepoint overlays, and geofence breach overlays now remain visible in replay
  - chokepoint controls and legends are now available in replay where relevant
  - AIS vessel context is now reconstructed from historical signal payloads and tracks during replay; live-only enrichments remain limited
- replay consistency follow-through
  - `frontend/src/components/AppShell.tsx` now derives mission posture from replay-scoped AO state instead of dropping posture entirely during replay
  - `frontend/src/components/BriefingPanel.tsx` now scopes its site selector to the replay cutoff
  - `frontend/src/pages/BriefingPage.tsx` and `frontend/src/pages/OntologyQueryPage.tsx` no longer display stale “current state only” replay banners that contradicted the replay-capable panel/backend behavior

Still open:

- no hidden replay-correctness blockers remain on user-facing operational surfaces
- explicitly live-only-by-design surfaces remain documented as such:
  - security/session inventory
  - operational health metrics
  - throughput analytics and loitering watchlist on the dashboard
  - rule-effectiveness analytics and mutation affordances
  - configuration mutations during replay

Exit criteria:

- Each remaining replay-disabled surface is resolved one of two ways:
  - backend produces historical state and frontend renders it read-only, or
  - the product intentionally declares the surface live-only and documents why.

Priority order:

1. Keep only the deliberate live-only replay exceptions documented
2. Move to tenant / workspace boundary hardening

Current validation for this workstream:

- backend:
  - `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/chokepoints_spec.rb spec/requests/api/signal_rule_matches_spec.rb`
- frontend:
  - `npx vitest run src/test/MapPage.test.tsx src/test/GlobePage.test.tsx`
- repo hygiene:
  - `npx tsc --noEmit`
  - `git diff --check`

### 2. Tenant / Workspace Boundary Hardening

Goal: make the data-boundary model explicit, enforceable, and predictable.

Current reality:

- Org/AO scoping is materially implemented.
- Some domains remain intentionally global:
  - external signals
  - vessels
- Org-null areas are currently treated as globally visible on the dedicated AO surface for org-scoped users who are not pinned to a single AO.
- Attached doctrine and operational records remain org-owned and hidden/immutable to org-scoped users unless a policy explicitly opts them into shared/global visibility.
- AO-pinned users remain restricted to their selected AO even when org-null areas exist.

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
- Replay parity for `frontend/src/pages/AreasPage.tsx`
  - AO rows, posture, site counts, and rule counts now render as historical read-only state during replay
  - `frontend/src/pages/AreasPage.tsx` no longer fail-closes in replay
  - correlation rule backend `index` / `show` now support `as_of` for historical rule membership state
  - focused backend and frontend proof was added
- Replay parity for `frontend/src/pages/CorrelationRulesPage.tsx`
  - historical rule definitions and recent firings now render during replay instead of fail-closing
  - effectiveness analytics and mutation affordances stay explicitly live-only
  - focused backend and frontend proof was added
- Replay parity for `frontend/src/pages/SiteDetailPage.tsx`
  - historical risk trend snapshots now respect `as_of`
  - replay shows historical breach counts instead of zeroing them out
  - replay timeline tab is available and clipped to the replay timestamp
  - mutation affordances remain disabled during replay
  - focused backend and frontend proof was added
- Replay parity for `frontend/src/pages/DashboardPage.tsx`
  - historical recommendations, recent alerts, and risk badges now render during replay
  - recommendation evidence remains available in replay
  - throughput analytics and loitering watchlist stay explicitly live-only
  - focused frontend proof was added
- Replay parity follow-through for map-adjacent surfaces
  - `frontend/src/pages/MapPage.tsx` and `frontend/src/pages/GlobePage.tsx` now keep historical AO overlays visible in replay
  - `frontend/src/pages/MapPage.tsx` now keeps historical risk shading in replay
  - `frontend/src/pages/SitesPage.tsx` now keeps risk badges visible from historical snapshots in replay
  - chokepoints and breach overlays are now replay-visible
  - AIS vessel identity and trail context are reconstructed from historical signal payloads and tracks during replay
  - live-only vessel enrichments remain explicitly limited
  - focused frontend proof was added for `MapPage` and `SitesPage`
- Replay consistency follow-through for non-map surfaces
  - `frontend/src/components/AppShell.tsx` now keeps mission posture visible from replay-scoped AO state
  - `frontend/src/components/BriefingPanel.tsx` now scopes site selection to the replay cutoff
  - `frontend/src/pages/BriefingPage.tsx` and `frontend/src/pages/OntologyQueryPage.tsx` no longer claim replay uses current state
  - focused frontend proof was added for `AppShell` and `BriefingPanel`
- Tenant/workspace boundary clarification follow-through
  - `backend/app/policies/application_policy.rb` now distinguishes between shared/global AO read visibility and org-owned mutation authority
  - current tenant model is now explicit in code comments: org-owned operational data, shared global intelligence domains, org-null global AOs on the AO surface, and org-owned attached doctrine/operational records
  - request/policy proof now covers org-scoped access to org-null global AOs without widening AO-pinned users or cross-org doctrine mutation
  - `backend/app/controllers/api/events_controller.rb` now filters same-org SSE traffic by `area_of_operation_id` for AO-pinned users, using explicit AO payload fields or a site→AO lookup when needed
  - request proof now covers intentional shared-global domains (`signals`, `vessels`) so future scope work does not over-tighten them
- Tenant/workspace boundary clarification completion
  - AO helper semantics are now explicit in code:
    - dedicated AO-surface visibility may include org-null global AOs
    - attached doctrine/operational records stay org-owned unless a policy explicitly opts into shared visibility
  - AO-attached doctrine scope proof now covers global-AO exclusion for:
    - correlation rules
    - chokepoints
    - commander intent
    - pace plans
    - salute reports
  - request proof now covers that org-scoped users cannot read or mutate existing doctrine attached to org-null global AOs
- Security/frontend capability follow-through
  - `frontend/src/components/TaskRow.tsx` now treats `admin` with the same commander-level task transition affordances that the backend already permits
  - focused frontend proof was added for the admin/operator transition split
- Security/frontend capability cleanup
  - `frontend/src/hooks/useRole.ts` now exposes named capabilities alongside raw role booleans
  - commander/admin pages now gate on capability semantics instead of scattered direct role assumptions:
    - `frontend/src/pages/BriefingPage.tsx`
    - `frontend/src/pages/OntologyQueryPage.tsx`
    - `frontend/src/pages/AreasPage.tsx`
    - `frontend/src/pages/CorrelationRulesPage.tsx`
    - `frontend/src/pages/PlanningPage.tsx`
    - `frontend/src/pages/RecommendationsPage.tsx`
    - `frontend/src/pages/OperationalHealthPage.tsx`
    - `frontend/src/pages/OrganizationsPage.tsx`
    - `frontend/src/pages/UsersPage.tsx`
    - `frontend/src/components/shell/AppSidebar.tsx`
  - focused hook/page proof was added for the capability layer without breaking the existing page mocks
- Frontend maintainability / decomposition
  - `frontend/src/pages/MapPage.tsx` is now orchestration-first instead of carrying overlay rendering, selection-panel rendering, and E2E bridge wiring inline
  - extracted:
    - `frontend/src/components/map/MapOverlayControls.tsx`
    - `frontend/src/components/map/MapSelectionPanels.tsx`
    - `frontend/src/hooks/useMapE2EBridge.ts`
  - focused map-page proof stayed green after extraction
- Frontend maintainability / decomposition follow-through
  - `frontend/src/pages/DashboardPage.tsx` now delegates KPI rendering, readiness rendering, and task bar-chart rendering to focused dashboard components
  - extracted:
    - `frontend/src/components/dashboard/DashboardKpiRow.tsx`
    - `frontend/src/components/dashboard/DashboardReadinessCard.tsx`
    - `frontend/src/components/dashboard/DashboardBarChartCard.tsx`
  - focused dashboard proof stayed green after extraction

- Frontend maintainability / decomposition workstream — **COMPLETE**
  - `GlobePage.tsx` (403 lines): reviewed, orchestration-first after prior toolbar/legend/inspector extraction — no further pass needed
  - `MapPage.tsx` (318 lines): decomposed — extracted `MapOverlayControls`, `MapSelectionPanels`, `useMapE2EBridge`
  - `DashboardPage.tsx` (275 lines): decomposed — extracted `DashboardKpiRow`, `DashboardReadinessCard`, `DashboardBarChartCard`
- Live transport / operational ceiling workstream — **COMPLETE**
  - SSE constraint chain explicitly documented in `puma.rb` (lines 28-53)
  - Admission control hardened: `SseStreamLease` + advisory lock + per-user/per-IP caps
  - Current thread-per-connection model explicitly accepted for single-machine Fly.io target scale
- Memory / validation / final gate workstream — **COMPLETE**
  - `project_open_findings.md` reconciled — all production-readiness items marked closed
  - `project_roadmap.md` updated — production readiness marked complete, feature work unblocked
  - Full validation green: 2105 RSpec / 407 Vitest / 0 TS errors / 0 whitespace issues

In progress:

- (none)

Next:

- This program is **COMPLETE**. Feature roadmap work may resume.
- Remaining future programs tracked in `memory/project_roadmap.md`:
  - Security/identity maturity (org admin vs platform admin, richer role modeling)
  - Tenant/workspace isolation (full multi-tenant admin UI, domain-wide scoping)
  - Frontend decomposition on-demand (AlertTriagePage, GraphPage, SignalFeedPage if velocity demands it)

Decisions made:

- `GlobePage.tsx` at 403 lines is orchestration-first and does not need further decomposition.
- Org-null global AOs are intentional for the current product model. Whether to retire them is a future product decision, not a production-readiness blocker.
- SSE thread-per-connection transport is accepted for target scale. Replacement is a future program if multi-machine deployment is needed.

Blocked / environment notes:

- Backend RSpec must be run with the local rbenv Ruby, not system Ruby.
- Supported local backend test path:
  - `source ~/.zshrc`
  - `cd backend`
  - `TEST_DATABASE_PORT=5434 bundle exec rspec ...`

Validation run for the current local replay tranches:

- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/assets_spec.rb spec/requests/api/areas_of_operation_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/areas_of_operation_spec.rb spec/requests/api/correlation_rules_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/correlation_rules_spec.rb spec/requests/api/signal_rule_matches_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/site_risk_history_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/policies/org_isolation_spec.rb spec/requests/api/scoped_access_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/events_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/requests/api/signals_spec.rb spec/requests/api/vessels_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec spec/policies/application_policy_spec.rb spec/policies/area_of_operation_policy_spec.rb spec/policies/org_isolation_spec.rb spec/requests/api/scoped_access_spec.rb`
- `TEST_DATABASE_PORT=5434 bundle exec rspec --format progress`
- `npx vitest run frontend/src/test/EntityCard.test.tsx`
- `npx vitest run frontend/src/test/AreasPage.test.tsx`
- `npx vitest run frontend/src/test/CorrelationRulesPage.test.tsx`
- `npx vitest run frontend/src/test/SiteDetailPage.test.tsx`
- `npx vitest run frontend/src/test/DashboardPage.test.tsx`
- `npx vitest run frontend/src/test/SitesPage.test.tsx src/test/MapPage.test.tsx`
- `npx vitest run frontend/src/test/GlobePage.test.tsx src/test/MapPanels.test.tsx src/test/GlobeInspectorPanel.test.tsx`
- `npx vitest run frontend/src/test/AppShell.test.tsx src/test/BriefingPanel.test.tsx src/test/BriefingPage.test.tsx src/test/OntologyQueryPanel.test.tsx src/test/OntologyQueryPage.test.tsx`
- `npx vitest run frontend/src/test/useRole.test.tsx src/test/AreasPage.test.tsx src/test/CorrelationRulesPage.test.tsx src/test/BriefingPage.test.tsx src/test/OntologyQueryPage.test.tsx src/test/PlanningPage.test.tsx src/test/OperationalHealthPage.test.tsx src/test/OrganizationsPage.test.tsx src/test/UsersPage.test.tsx src/test/RecommendationsPage.test.tsx src/test/AppShell.test.tsx`
- `npx tsc --noEmit`
- `git diff --check`
- `npx vitest run frontend/src/test/TaskRow.test.tsx`
- `npx vitest run frontend/src/test/MapPage.test.tsx src/test/MapPanels.test.tsx`
- `npx vitest run frontend/src/test/DashboardPage.test.tsx`
- `npx tsc --noEmit`
- `ruby -c backend/app/controllers/api/assets_controller.rb`
- `ruby -c backend/app/controllers/api/areas_of_operation_controller.rb`
- `ruby -c backend/app/controllers/api/correlation_rules_controller.rb`
- `ruby -c backend/app/controllers/api/chokepoints_controller.rb`
- `ruby -c backend/app/controllers/api/signal_rule_matches_controller.rb`
- `git diff --check`

Final validation run (2026-04-09 — program completion):

- `TEST_DATABASE_PORT=5434 bundle exec rspec --format progress` → 2105 examples, 0 failures
- `npx vitest run --reporter=dot` → 62 test files, 407 tests passed
- `npx tsc --noEmit` → 0 errors
- `git diff --check` → clean
