---
name: project_open_findings
description: Open engineering debt and architecture programs
type: findings
---

# Resilience — Open Findings

Last reconciled with code: 2026-05-01

The production-readiness program is complete (closed plan archived under
`.claude/memory/project_production_readiness_plan.md`).
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

- SSE transport ceiling remains a future scale project, not a current demo blocker.
  - Fresh production smoke on Fly version 46 was clean after deploying the authenticated per-user SSE throttle fix.
  - `/map` and `/globe` both rendered without stale-data or telemetry-offline warnings; the observed SSE stream opens returned `200`.
  - Thread-per-connection SSE replacement is still future scale work if multi-machine or materially higher concurrency becomes a real target.

- Frontend `yarn audit` triage (2026-05-01).
  - `yarn audit --level high` is **clean** (CI-fail threshold). 21 moderate advisories remain, all transitive, all triaged below.
  - **dompurify** ×8 across 4 CVEs (mXSS / FORBID_TAGS bypass / prototype pollution).
    - Path: `cesium#@cesium#engine#dompurify@3.3.3`. Cesium uses DOMPurify internally for entity HTML sanitization (descriptions, infoboxes).
    - Single-tenant deployment limits the cross-tenant XSS surface. The app does not directly invoke DOMPurify; exposure depends on whether user-supplied entity strings flow into Cesium's HTML pipeline.
    - **Disposition:** Accept until upstream Cesium ships a newer DOMPurify. Forced overrides via `resolutions:` carry Cesium-API regression risk that exceeds the current marginal exposure.
  - **brace-expansion** ×9 (regex DOS).
    - Path: `@vitest/coverage-v8` and `vite-plugin-pwa#workbox-build` build chains.
    - **Build-time only.** No runtime exposure. Disposition: accept.
  - **protocol-buffers-schema** ×3 (prototype pollution).
    - Path: `maplibre-gl#pbf#resolve-protobuf-schema`. Used to parse vector tile protobufs.
    - Tile transport is HTTPS to trusted origins; not exposed to attacker-controlled protobufs in the live deployment. Disposition: accept until upstream maplibre-gl ships a newer pbf.
  - **serialize-javascript** ×1 (CPU exhaustion DOS).
    - Already pinned via `package.json` `resolutions: { "serialize-javascript": "^7.0.3" }` — the safe-version override is in place. No further action.
  - **Re-evaluate when:** any of these moves to `high` severity, OR direct app usage of DOMPurify is added, OR a multi-tenant deployment ships.

## P3 / Ongoing Hygiene

- Frontend decomposition is substantially closed.
  - [EntityCard.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/EntityCard.tsx)
    closed at `830ceb3` (635 → 92-line public surface,
    sub-modules in `entity-card/`).
  - [MapOverlayControls.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/components/map/MapOverlayControls.tsx)
    closed at `5148b8f` (884 → 205-line orchestrator, 11
    sibling files in `overlay-controls/`); 35 direct unit
    tests landed first as the regression net at `fdcda0b`.
  - [MapPage.tsx](/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx)
    was decomposed across six tranches from 905 lines to 351
    with behavior preserved and the page reduced to a wiring
    harness over named ownership seams.
  - Current judgment: stop here unless a new concrete seam
    appears. Further extraction now risks wrapper churn more
    than architectural improvement.

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

- ~~`AuditEvent.up_to` non-deterministic iteration order on same-`occurred_at` events~~ —
  closed in this sweep. The scope now appends `.order(:sequence)`, where
  `sequence` is the postgres-issued globally monotonic id
  (`DEFAULT nextval('audit_events_sequence_seq')`). Callers that already
  apply their own order compose additively; the sequence clause acts only
  as a final tiebreaker. Direct regression spec at
  [backend/spec/models/audit_event_spec.rb](/Users/timurmishiev/Desktop/Code/resilience/backend/spec/models/audit_event_spec.rb)
  (`.up_to ... orders results by sequence so same-occurred_at events return in deterministic chain order`).
- ~~No regression spec for chain-tip determinism under same-`Time.current` burst writes~~ —
  closed in this sweep (was OVL-2 from the joint 2026-05-01 audit).
  New spec drives 5 sequential `Audit::EventWriter.write` calls under
  `travel_to(fixed_time)` and asserts (a) chain_position deltas are 1
  between consecutive rows, (b) all share the same occurred_at, (c)
  every prev_hash equals the previous row_hash, and (d) every row_hash
  matches a fresh `ChainHasher.compute` recomputation. Located at the
  same model spec as F5.

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
