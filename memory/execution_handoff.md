---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-15

## Current Phase

Phase 2 — Map Workstation + Triage-in-Context

## Current Slice

Slice 3 — first triage-in-context content: render a compact "Unacknowledged alerts" section inside the docked `MapSitePanel`, site-scoped, with an inline Acknowledge button — COMPLETE

## Objective

Begin putting real operational content inside the docked panel so that `/map` stops being a passive detail view and becomes a place where operators can act on what they see without leaving the map.

## Why This Slice

Slice 1 gave us the container; Slice 3 validates that the container is actually a useful work surface. Site-scoped alerts are the lowest-friction payload: the backend already has `for_site`, `unacknowledged`, and the `transition` endpoint, so we get a live triage loop without inventing new scopes. Asset- and signal-scoped alert triage needs new backend scopes and is deferred to a later slice.

## Completed This Session

- new `MapSiteAlertsSection.tsx` — compact up-to-5 unacknowledged alert rows for the selected site; reuses `useSignalRuleMatches({ site_id, workflow_status: 'unacknowledged', per_page: 5 })` with 10s refetch, disables itself entirely in replay mode, renders empty / loading / error states, and includes an overflow link to `/alerts?site_id=…&workflow_status=unacknowledged` when `meta.total` exceeds the displayed rows
- each row renders rule name (falls back to "Geofence breach" / "Unknown rule"), fired-at age off the shared `referenceTimeMs` clock, confidence %, and (for operator/commander) an inline **Ack** button wired to `useTransitionAlert` with `to_status: 'acknowledged'`
- threaded `canTriage` (`canTriageAlerts` from `useRole`) and `referenceTimeMs` (`useReferenceTimeMs(isReplaying ? asOf : null)`) from `MapPage` → `MapSelectionPanels` → `MapSitePanel` → `MapSiteAlertsSection`
- added `.map-site-alerts*` dark-theme styles in `index.css`, slotted below the existing task list inside `MapSitePanel` after a `<Divider />`
- new `MapSiteAlertsSection.test.tsx` (6 tests): empty state, row rendering with shared-clock age + confidence, Ack mutation payload, role gating hides Ack, overflow link, replay null-render
- existing `MapPanels.test.tsx` got a lightweight `vi.mock` for `MapSiteAlertsSection` so `MapSitePanel`'s isolated render test stays free of QueryClient/Router setup

## In Progress

Nothing.

## Next

- Phase 2 Slice 2 — add a keyboard toggle (and possibly a resize handle) for the docked panel so operators can open it without a selection and resize it within sane bounds
- Phase 2 Slice 4 — extend triage-in-context to asset/signal selections. This likely needs new backend scopes (`for_asset`, or a signal-level join) since `SignalRuleMatch` has no `asset_id` column today — scope the backend work at the start of that slice

## Files Likely To Change

- `/Users/timurmishiev/Desktop/Code/resilience/memory/execution_context.md`
- `/Users/timurmishiev/Desktop/Code/resilience/memory/execution_handoff.md`
- `/Users/timurmishiev/Desktop/Code/resilience/frontend/src/pages/MapPage.tsx`
- Phase 2 `/map` workstation surfaces — to be scoped at the start of that slice

## Currently Locked Files

None.

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src
cd /Users/timurmishiev/Desktop/Code/resilience && git diff --check
```

## Last Validation Results

Phase 2 Slice 3 closeout validation run:

- Vitest: full suite — 68 files, 461 tests, 0 failures (added 6 tests in the new `MapSiteAlertsSection` suite)
- TypeScript: 0 errors (`tsc -b` clean)
- ESLint: 0 errors

## Known Risks / Blockers

- Phase 1 is now closed. `lib/formatters.ts` `timeAgo()` still falls back to `Date.now()` when called with no `nowMs`; remaining callers (`OrganizationsPage`, `UsersPage`, `correlationRules/types.ts`) are intentionally left on wall-clock as admin/config surfaces, not trust surfaces.

## Open Questions

- Are the initial freshness thresholds still appropriate once more sources are folded into the shared model?
- Should the first detailed source-health view live in the navbar indicator or on an existing commander-only operational surface?

## Do Not Reopen

- Phase 0 — Execution Foundation after these two files are accepted
- Phase 1 Slice 2 shell degraded-state visibility (`d3bf38a`)
- Phase 1 Slice 3 `AssetsPage` freshness adoption
- Phase 1 Slice 4 navbar source-health detail
- Phase 1 Slice 5 `EntityCard` freshness adoption
- Phase 1 Slice 6 operational-health snapshot freshness language
- Phase 1 Slice 7 site timeline reference-time normalization
- Phase 1 Slice 8 incident replay-relative recency
- Phase 1 Slice 9 loitering watchlist live reference-time normalization
- Phase 1 Slice 10 operational health tables shared reference-time adoption
- Phase 1 — Trustworthy Operational Picture (all non-spatial trust surfaces now read the shared live reference clock)
- Phase 2 Slice 1 docked map context panel + viewport re-measurement
- Phase 2 Slice 3 site-scoped unacknowledged-alerts section inside the docked `MapSitePanel` (reusing `useSignalRuleMatches` + `useTransitionAlert`, `canTriage` + shared reference clock threaded through)
- Inherited-findings infra fixes B-3 (`DB_STATEMENT_TIMEOUT_MS` default 30s) and I-1 (CI concurrency group)
- production-readiness closeout work
- replay parity, auth hardening, and tenant-boundary cleanup that are already closed in the existing memory files
