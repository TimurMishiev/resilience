---
name: project_open_findings
description: Open engineering debt and architecture programs
type: findings
---

# Resilience — Open Findings

Last reconciled with code: 2026-04-09

The production-readiness program (`memory/project_production_readiness_plan.md`) is now complete.
Future work is tracked in `memory/project_roadmap.md`.

## P1 / High-Leverage Programs

_(No open P1 items. All prior P1 replay parity gaps have been closed.)_

## P2 / Important Platform Follow-Through

- Tenant/workspace isolation: production-readiness scope is **closed**.
  - Org/AO scoping is enforced in policies with request-level proof.
  - Tenant model is explicit in code: org-owned operational/doctrine data, shared global intelligence domains (`ExternalSignal`, `Vessel`), org-null global AOs on the AO surface, hidden/immutable cross-org doctrine.
  - Full multi-tenant admin UI and workspace management remain a future roadmap program.

- Frontend decomposition: production-readiness scope is **closed**.
  - Engine hooks (`useGlobeEngine`, `useMapLibreEngine`) decomposed into focused sub-hooks.
  - Core pages decomposed: `MapPage.tsx` (318 lines), `DashboardPage.tsx` (275 lines), `GlobePage.tsx` (403 lines), `CorrelationRulesPage.tsx` (343 lines), `PlanningPage.tsx` (462 lines).
  - Remaining large pages (`AlertTriagePage` 570, `GraphPage` 519, `SignalFeedPage` 505) are future candidates if velocity demands it.

- SSE transport ceiling: production-readiness scope is **closed**.
  - Admission control is hardened (lease-based, per-user + per-IP caps, advisory locks).
  - Constraint chain is explicitly documented in `puma.rb`.
  - Thread-per-connection model is accepted for single-machine Fly.io target scale.
  - Replacing the transport is a future scale project if multi-machine deployment is needed.

- ~~Risk score replay is not yet supported.~~ — DONE: `RiskScoresController#replay_risk_scores` with `as_of` + 3 specs.

- ~~Feed ingestion runs in boot-time threads, not Solid Queue.~~ — DONE: `Feeds::PollJob` + `config/recurring.yml` entries for all 7 feeds.

- ~~Adversarial test coverage is sparse for the correlation engine and recommendation pipeline.~~ — DONE: 12 adversarial specs in `spec/services/adversarial/correlation_edge_cases_spec.rb`.

## P3 / Ongoing Hygiene

- Keep `backend/db/structure.sql` and the local test environment aligned with the supported PostGIS baseline.
- Keep `memory/project_resilience.md`, roadmap file, and actual code aligned.
- ~~Fix pre-existing ESLint violations (3 errors: `RuleFormDrawer.tsx` setState-in-effect, `PlanningChokepointsSection.tsx` unused var, `PlanningPage.tsx` unused import).~~ — DONE: `eslint src` exits clean (0 errors).
- ~~Fix pre-existing TypeScript build errors (19 errors across 8 files — `PlanningPage.tsx` type mismatches, `useMapLibreEngine.ts` missing types, test files with null assignability).~~ — DONE: `tsc --noEmit` exits clean (0 errors).

## Closed Since Last Reconciliation

- ~~Replay parity on RecommendationsPage, OntologyQueryPanel, IncidentDetailPage, AlertTriagePage~~ — all four now pass `as_of` and gate mutations during replay.
- ~~Replay parity on EntityCard / AreasPage / CorrelationRulesPage / SiteDetailPage / DashboardPage / MapPage / GlobePage~~ — historical read-only state now renders across the main operational surfaces, including AO overlays, chokepoints, breach overlays, and replay-safe AIS vessel context on map/globe.
- ~~Replay messaging drift on BriefingPage / OntologyQueryPage / AppShell~~ — fixed: page copy and shell mission posture now match the replay-capable backend and panel behavior.
- ~~AO global-scope enforcement drift between `Scope` and `show?`~~ — fixed: org-null global AOs are now enforced consistently for org-scoped users, while AO-pinned users remain narrowed to their selected AO.
- ~~AO-scoped SSE users can receive same-org events from other AOs~~ — fixed: `EventsController` now filters by `area_of_operation_id` (or resolves it from `site_id`) for AO-pinned users.
- ~~Admin users lose commander-level task transitions in the map/site task panel~~ — fixed: `TaskRow` now treats `admin` with commander-equivalent task transition affordances, matching backend policy.
- ~~Session security maturity (sign out all devices)~~ — shipped: `SecurityPage.tsx` + `sessions_controller.rb` support bulk revocation with `?all_sessions=true`, `keep_current`, and admin cross-user management.
- ~~16 controllers skip_after_action :verify_authorized~~ — all removed; Pundit is fully enforced across every controller.
- ~~Security/identity maturity (session lifecycle)~~ — shipped: `UserSession` model with jti tracking, per-session revocation, admin session management, `tokens_valid_after` for global logout.
