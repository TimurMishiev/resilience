---
name: project_open_findings
description: Open engineering debt and architecture programs
type: findings
---

# Resilience — Open Findings

Last reconciled with code: 2026-04-04

Active execution of these findings is tracked in `memory/project_production_readiness_plan.md`.
No new feature work should take precedence over that file until the production-readiness program is complete.

## P1 / High-Leverage Programs

_(No open P1 items. All prior P1 replay parity gaps have been closed.)_

## P2 / Important Platform Follow-Through

- Tenant/workspace isolation is still missing.
  - Organization model + org/AO scoping exist, but domain-wide data isolation, workspace management, and admin tenant UI are not built.
  - This is acknowledged as a major track, not a quick patch.

- Frontend maintenance concentration substantially reduced:
  - `useGlobeEngine.ts` (1156→453 lines): overlays extracted to `hooks/globe/useGlobeOverlays.ts` (409), tracks to `hooks/globe/useGlobeTrackLayers.ts` (163), assets to `hooks/globe/useGlobeAssetEntities.ts` (120), signals to `hooks/globe/useGlobeSignalPrimitives.ts` (147), sites to `hooks/globe/useGlobeSiteEntities.ts` (104)
  - `useMapLibreEngine.ts` (876→378 lines): overlays extracted to `hooks/map/useMapOverlays.ts` (280), assets to `hooks/map/useMapAssetLayers.ts` (139), sites to `hooks/map/useMapSiteLayers.ts` (97), tracks to `hooks/map/useMapTrackLayers.ts` (115)
  - `GlobePage.tsx` (487 lines) — reasonable size after prior toolbar/legend/inspector extraction
  - `CorrelationRulesPage.tsx` and `PlanningPage.tsx` already decomposed

- The remaining SSE architecture ceiling is still thread-per-connection transport.
  - Admission control is hardened (lease-based, per-user + per-IP caps, advisory locks).
  - The transport model itself is unchanged — replacing it is a future scale project.

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
- ~~Session security maturity (sign out all devices)~~ — shipped: `SecurityPage.tsx` + `sessions_controller.rb` support bulk revocation with `?all_sessions=true`, `keep_current`, and admin cross-user management.
- ~~16 controllers skip_after_action :verify_authorized~~ — all removed; Pundit is fully enforced across every controller.
- ~~Security/identity maturity (session lifecycle)~~ — shipped: `UserSession` model with jti tracking, per-session revocation, admin session management, `tokens_valid_after` for global logout.
