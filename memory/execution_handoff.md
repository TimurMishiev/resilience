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

Slice 1 — dock the map context panel on the right side of `/map` and make MapLibre re-measure the viewport when the panel opens or closes, so selected pins stop being hidden by their own detail card — COMPLETE

## Objective

Lay the foundational layout primitive for Phase 2: the map page should reserve real estate for selection detail on the right instead of floating cards over the map, and MapLibre's internal viewport must stay consistent with the docked layout when the panel opens or closes.

## Why This Slice

Every later Phase 2 deliverable (site/entity/alert detail without leaving `/map`, triage-in-context, cross-panel coordination) composes onto a docked panel that owns a fixed slice of the viewport. Getting the container contract and `map.resize()` plumbing right in isolation avoids paying for a layout change on every subsequent slice.

## Completed This Session

- exposed `resize()` from `useMapLibreEngine` so the MapLibre instance can be re-measured after container-width changes
- restructured `MapPage.tsx` into a flex row with a `.map-viewport` child and an `aside.map-context-panel` that renders only when a site/asset/signal is selected, with Escape-to-clear wiring and an effect that calls `resize()` on panel open/close
- added `.map-context-panel` styles and overrode the nested `.map-panel` positioning so the existing typed panels flow as blocks inside the dock instead of stacking as absolute overlays
- widened the `useMapLibreEngine` mock in `MapPage.test.tsx` to expose a `resize` spy and added two tests: (1) selecting a site docks the panel and triggers resize, (2) Escape closes the panel and clears the route
- shipped the accumulated infra hardening separately: `DB_STATEMENT_TIMEOUT_MS` on primary production connections (default 30s, overridable) and a CI concurrency group that cancels stale feature-branch runs while preserving main

## In Progress

Nothing.

## Next

- Phase 2 Slice 2 — add a keyboard toggle (and possibly a resize handle) for the docked panel so operators can open it without a selection and resize it within sane bounds
- Phase 2 Slice 3 — first triage-in-context content: scoped recent unacknowledged alerts for the selected site/entity with limited inline actions (explicitly not the full AlertTriagePage)

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

Phase 2 Slice 1 closeout validation run:

- Vitest: full suite — 67 files, 455 tests, 0 failures (MapPage test suite grew from 14 to 16)
- TypeScript: 0 errors (`tsc -b && vite build` clean)
- ESLint: 0 errors
- Rails spec spot-check (`auth_sessions_spec.rb`): 9/9 green — confirms the `database.yml` `variables: { statement_timeout }` addition boots cleanly

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
- Inherited-findings infra fixes B-3 (`DB_STATEMENT_TIMEOUT_MS` default 30s) and I-1 (CI concurrency group)
- production-readiness closeout work
- replay parity, auth hardening, and tenant-boundary cleanup that are already closed in the existing memory files
