---
name: project_open_findings
description: Open engineering debt and architecture programs
type: findings
---

# Resilience — Open Findings

Last reconciled with code: 2026-04-29

The production-readiness program (`memory/project_production_readiness_plan.md`) is complete.
Execution-context Phases 1–7 are complete.

The audit-remediation backlog is **closed**. The merged findings matrix in:
- `.claude/skills/resilience-remediation/references/findings.md`
- `.codex/skills/resilience-remediation/references/findings.md`

is now a historical closure record, not an active defect queue.

This file is kept as a historical summary of closed production-readiness debt plus any remaining P2/P3 hygiene items that do not fit cleanly into the remediation bands.

## P1 / High-Leverage Programs

_(No open P1 items.)_

## P2 / Important Platform Follow-Through

- Tenant/workspace isolation: production-readiness scope is **closed**.
  - Org/AO scoping is enforced in policies with request-level proof.
  - Multi-tenant admin UI and workspace management remain a future roadmap program, not an active defect.

- SSE transport ceiling remains a future scale project, not a current blocker.
  - Admission control, reconnect throttling, and scope refresh hardening are closed for the current Fly deployment target.
  - Replacing thread-per-connection SSE is still future scale work if multi-machine or materially higher concurrency becomes a real target.

## P3 / Ongoing Hygiene

- Frontend decomposition is mostly closed; only `MapPage.tsx`
  remains as deferred decomp debt.
  - [EntityCard.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/EntityCard.tsx)
    closed at `830ceb3` (635 → 92-line public surface,
    sub-modules in `entity-card/`).
  - [MapOverlayControls.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/map/MapOverlayControls.tsx)
    closed at `5148b8f` (884 → 205-line orchestrator, 11
    sibling files in `overlay-controls/`); 35 direct unit
    tests landed first as the regression net at `fdcda0b`.
  - [MapPage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx)
    (905 lines) is the only remaining large file. Per user
    direction it stays deferred unless line-count architecture
    debt is independently judged worth the blast radius before
    Palantir review.
  - This is not a production blocker.

- GPU-dependent map Playwright proof remains intentionally local/manual,
  not CI-gated.
  - [map-site-selection.spec.ts](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/map-site-selection.spec.ts),
    [live-map-streams.spec.ts](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/live-map-streams.spec.ts),
    and [replay-map.spec.ts](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/replay-map.spec.ts)
    stay `test.skip(!!process.env.CI, ...)` because the current CI
    swiftshader path does not provide dependable MapLibre canvas proof.
  - Explicit decision at `ac626fb`: keep these as local-GPU/manual
    smoke tests until a reliable GPU-capable lane exists, rather than
    pretending they are CI-verifiable today.
  - Current proof: `map-site-selection.spec.ts` 2/2 passed locally;
    direct production browser smoke after deploy verified `/map`
    and `/globe` render authenticated `LIVE` surfaces with zero page
    errors or failed requests; and standard replay smokes
    (`replay-map.spec.ts`, `replay-globe.spec.ts`) now pass against
    production after the live viewer-account repair and the copy
    alignment in `563ce5c`.
  - This is accepted proof-quality debt, not a known runtime defect.

- Keep `backend/db/structure.sql` and the local test environment aligned with the supported PostGIS baseline.
- Keep `memory/project_resilience.md`, `memory/execution_handoff.md`, and actual code aligned.

- Hardening-to-95 item 8 (`4B` — access-pattern anomaly detection) remains stakeholder-blocked.
  - This is an open initiative, not a latent production defect.

## Closed Since Last Reconciliation

- ~~MapOverlayControls.tsx 884-line monolith~~ — closed at
  `5148b8f`. Public surface is now `MapOverlayControls.tsx`
  (205 lines, orchestrator); 11 sub-components live in
  `components/map/overlay-controls/` (`derivations.ts`,
  `StatusOverlays`, `TelemetryBadge`, `StyleSwitcher`,
  `LayerToggles`, `ToolToggleStrip`, `AnnotatePanel`,
  `RangeRingPanel`, `SectorPanel`, `BearingLinePanel`,
  `MeasurementPanel`). Tests-first foundation landed at
  `fdcda0b` (35 direct unit tests covering every major
  rendering branch); decomp ran under that net. Public
  imports unchanged (only callsite is `MapPage.tsx`).
- ~~Globe primitive-pickup E2E proof debt~~ — closed at `6d0f100`.
  All 3 previously-`fixme`d tests
  ([globe-overlay-clickthrough.spec.ts:167](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/globe-overlay-clickthrough.spec.ts),
  [globe-site-anchor.spec.ts:248](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/globe-site-anchor.spec.ts),
  [globe-site-anchor.spec.ts:311](/Users/timurmishiev/Desktop/Code/resilience/frontend/e2e/globe-site-anchor.spec.ts))
  pass interactively. Root cause was the `/api/sites` stub
  returning `{ data: sites }` without the `meta` field;
  `fetchAllPaginated` reads `meta.total_pages` and threw on
  every globe E2E run, leaving `sitesQuery.data` undefined and
  the bridge `state.sites` array empty. Fix added the
  `PaginatedResponse` `meta` envelope to both spec helpers.
  ~60 lines of stale "Cesium primitive-pickup unknown" framing
  comments removed.
- ~~EntityCard.tsx 635-line monolith~~ — closed at `830ceb3`.
  Public surface is now `EntityCard.tsx` (92 lines); sub-components
  live in `components/entity-card/` (`internals.ts` 55,
  `Overviews.tsx` 336, `Relations.tsx` 118, `RawPanel.tsx` 23).
  Mechanical extraction; all 4 EntityCard tests + 20 consumer tests
  + 15 adjacent tests pass; tsc -b clean; eslint clean. Public
  imports unchanged (5 callsites untouched).
- ~~Map / globe engine-init failure handling~~ — closed at `7d662bf`.
  Both `useMapLibreEngine` and `useGlobeEngine` now expose
  `engineError` + `retryEngine`; `MapPage` and `GlobePage` render a
  Blueprint `NonIdealState` overlay with a Retry button when init
  rejects. Coverage: 6 new regression specs (3 per hook) for
  preload-reject, constructor-throw, and retry-recovers paths.
- ~~Replay parity on RecommendationsPage, OntologyQueryPanel, IncidentDetailPage, AlertTriagePage~~ — all four now pass `as_of` and gate mutations during replay.
- ~~Replay parity on EntityCard / AreasPage / CorrelationRulesPage / SiteDetailPage / DashboardPage / MapPage / GlobePage~~ — historical read-only state now renders across the main operational surfaces, including AO overlays, chokepoints, breach overlays, and replay-safe AIS vessel context on map/globe.
- ~~Replay messaging drift on BriefingPage / OntologyQueryPage / AppShell~~ — fixed: page copy and shell mission posture now match the replay-capable backend and panel behavior.
- ~~AO global-scope enforcement drift between `Scope` and `show?`~~ — fixed: org-null global AOs are now enforced consistently for org-scoped users, while AO-pinned users remain narrowed to their selected AO.
- ~~AO-scoped SSE users can receive same-org events from other AOs~~ — fixed: `EventsController` now filters by `area_of_operation_id` (or resolves it from `site_id`) for AO-pinned users.
- ~~Admin users lose commander-level task transitions in the map/site task panel~~ — fixed: `TaskRow` now treats `admin` with commander-equivalent task transition affordances, matching backend policy.
- ~~Session security maturity (sign out all devices)~~ — shipped: `SecurityPage.tsx` + `sessions_controller.rb` support bulk revocation with `?all_sessions=true`, `keep_current`, and admin cross-user management.
- ~~16 controllers skip_after_action :verify_authorized~~ — all removed; Pundit is fully enforced across every controller.
- ~~Security/identity maturity (session lifecycle)~~ — shipped: `UserSession` model with jti tracking, per-session revocation, admin session management, `tokens_valid_after` for global logout.
