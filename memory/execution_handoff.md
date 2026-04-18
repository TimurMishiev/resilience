---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-17

## Current Phase

Phase 3 — Spatial Analytics + Spatial Trust Rendering

## Current Slice

Phase 3 Slice 4: Signal-site evidence-linked spatial highlighting — COMPLETE

## Objective

When a site is selected, highlight any signals that have been linked to it via signal rule matches (evidence ring). Conversely, when a signal is selected, highlight the sites it's been matched to. Uses `useEvidenceLinkedIds` to fetch all scoped match pages on-demand, forwards replay `as_of`, and drives MapLibre filter expressions for GPU-evaluated orange evidence rings.

## Completed This Session

- `useEvidenceLinkedIds.ts` (NEW): hook that fetches all signal rule match pages for selected site/signal, forwards replay `as_of`, and extracts deduped linked entity IDs (`evidenceSignalIds`, `evidenceSiteIds`)
- `useMapLibreEngine.ts`: added `evidenceSignalIds` / `evidenceSiteIds` to `MapEngineInput`, destructured and threaded to sub-hooks
- `useMapSiteLayers.ts`: added `evidenceSiteIds` prop, `site-evidence-ring` layer (orange #f5a623 ring), filter effect
- `useMapSignalLayers.ts`: added `evidenceSignalIds` prop, `signal-evidence-ring` layer (orange #f5a623 ring on unclustered signals), filter effect, respects `showSignals` visibility toggle
- `MapPage.tsx`: wired `useEvidenceLinkedIds(selectedSiteId, selectedSignalId, asOf)` and passes results to engine
- `useMapLibreEngine.test.ts`: 4 new evidence ring tests — layer creation, site filter update, signal filter update, clear on empty
- `MapPage.test.tsx`: added replay `as_of` coverage for `useEvidenceLinkedIds`
- `useEvidenceLinkedIds.test.tsx` (NEW): proves replay `as_of` forwarding, multi-page fetch completeness, and linked-ID dedupe

## In Progress

- none

## Next

- Phase 3 Slice 5+ per `execution_context.md` Phase 3 deliverables
- Run `/gate` before committing

## Files Changed This Slice

- `frontend/src/hooks/useEvidenceLinkedIds.ts` (NEW)
- `frontend/src/hooks/useMapLibreEngine.ts`
- `frontend/src/hooks/map/useMapSiteLayers.ts`
- `frontend/src/hooks/map/useMapSignalLayers.ts`
- `frontend/src/pages/MapPage.tsx`
- `frontend/src/test/useEvidenceLinkedIds.test.tsx` (NEW)
- `frontend/src/test/useMapLibreEngine.test.ts`
- `frontend/src/test/MapPage.test.tsx`

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/useEvidenceLinkedIds.test.tsx src/test/MapPage.test.tsx src/test/useMapLibreEngine.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/useMapLibreEngine.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/hooks/useEvidenceLinkedIds.ts src/pages/MapPage.tsx src/test/useEvidenceLinkedIds.test.tsx src/test/MapPage.test.tsx
```

## Last Validation Results

- Focused evidence-linking tests: 63 tests, 0 failures (`useEvidenceLinkedIds`, `MapPage`, `useMapLibreEngine`)
- Full frontend suite: 70 files, 507 tests, 0 failures
- TypeScript: 0 errors
- ESLint on touched files: 0 errors

## Known Risks / Blockers

- Evidence ring highlighting fetches all signal rule match pages on-demand via `getSignalRuleMatches` — only fires when a site or signal is selected, with `refetchInterval: false` to avoid polling
- Large evidence sets may require multiple sequential page fetches; correctness now wins over silent truncation for this slice
- Signal evidence ring uses `['!', ['has', 'point_count']]` filter to skip clusters — only individual signals get the ring
- Both evidence ring layers survive style switching (driven by `mapLoaded` dep)
- Orange (#f5a623) color chosen for evidence rings to distinguish from selection (white) and linked (blue) rings

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 Slices 4–7 (triage-in-context, cross-panel coordination, task context)
- Phase 3 Slice 1 (asset freshness on map)
- Phase 3 Slice 2 (signal freshness on map)
- Phase 3 Slice 3 (cross-entity spatial highlighting)
- incident notes/prosecution standalone coverage slice
- replay parity, auth hardening, and tenant-boundary cleanup
- production blocker hardening tranche
