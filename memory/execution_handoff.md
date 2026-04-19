---
name: execution_handoff
description: Active handoff file for the current phase, slice, validation, and takeover safety
type: project
---

# Resilience — Execution Handoff

Last updated: 2026-04-19

## Current Phase

Phase 6 — Performance Characterization

(Phase 4 — Debrief closed. Phase 5 — Evidence Threading complete. Phase 6 active; Slice 6-1A shipped, 6-1B next.)

## Current Slice

**None active — 6-1A shipped.** Next actionable slice is **6-1B — Playwright `benchmark:map` spec + npm script** (see `Next` below). 6-1A landed `map.signal_reconcile` instrumentation in [useMapSignalLayers.ts:54-83](frontend/src/hooks/map/useMapSignalLayers.ts#L54-L83) and the `__resilienceMapBench` bridge in [useMapBenchmarkBridge.ts](frontend/src/hooks/useMapBenchmarkBridge.ts) (types in [components/map/types.ts](frontend/src/components/map/types.ts), mounted from [MapPage.tsx](frontend/src/pages/MapPage.tsx)).

## Current Repo State

- Latest shipped slice: `39008b6` — Phase 6 Slice 6-1A followup: document trigger priority, drop redundant bench field
- Working tree: clean on product; handoff commit pending
- For the literal tip SHA, run `git log -1` — it is intentionally not recorded here (self-referential with the commit that writes it).

## Phase 6 — Slice Plan

Sequenced per `Next` below: **6-1A** (instrumentation + bridge, shipped in `19020f3`) → **6-1B** (Playwright spec + `benchmark:map` script, next) → **6-1C** (baseline run, documented budgets, CI threshold assertions).

## Shipped In This Phase (Phase 6)

- `19020f3` — Phase 6 Slice 6-1A: map signal-reconcile instrumentation + benchmark bridge
- `39008b6` — Phase 6 Slice 6-1A followup: document trigger priority, drop redundant bench field

## Shipped In Phase 5 (closed)

- `e1632fc` — Phase 5 Slice 1: incident alert evidence access
- `024af49` — Phase 5 Slice 2-A-full: recommendation evidence access (labels + alert chain drill-through)
- `9b8614c` — Phase 5 Slice 2-A-followup: apply replay `fired_at <= as_of` filter uniformly to alert evidence labels (closes gate-flagged P3)
- `0ffec30` — Phase 5 Slice 2-B: wire AlertChainDrawer into map alert rows (site + signal panels)
- `1eb1c61` — Phase 5 Slice 2-C: stale-basis surfacing on alert evidence (AlertChainDrawer signal node + map section row tags)

Deferred from Phase 5: **5-2B-globe (optional) — globe alert evidence context**. Would require first adding alert rows to `GlobeInspectorPanel` (not present today — it shows nearest `Signal`s, not alerts). Treat as a separate slice only if an operator use-case warrants it.

## Shipped In Prior Phases (Phase 4 context)

- `2c49a3c` — Phase 4 Slice 1: debrief audit-events API prerequisites
- `afd68b7` — Phase 4 Slice 2: commander-only debrief timeline page
- `45906cb`, `d202532`, `67caf3b`, `70b3de4` — Phase 4 Slice 3: click-to-reconstruct + hardening
- `8ebedf9` — Phase 4 Slices 4a + 4b: temporal diff surfaces + incident A/B compare
- `eec8439` — Phase 4 Slice 4c: site A/B compare
- `7ba0155` — Phase 4 Slice 4c-followup: compare-tab hardening

## In Progress

- _(none — 6-1A shipped; 6-1B is the next actionable slice.)_

## Next

- **6-1B — Playwright `benchmark:map` spec + npm script.** Mirror [globe-benchmark.spec.ts](frontend/e2e/globe-benchmark.spec.ts): 5 trials of `bench.focusBenchmarkSite()` → wait for `map.signal_reconcile` event with `trigger === 'selection_set'` → `bench.clearSelection()` → wait for `selection_cleared`. Compute mean / p95 / max, attach JSON summary, and assert against generous initial budgets (env-overridable via `MAP_BENCH_MAX_MEAN_MS` / `MAP_BENCH_MAX_P95_MS` / `MAP_BENCH_MAX_SINGLE_SAMPLE_MS`). Add `"benchmark:map": "playwright test e2e/map-benchmark.spec.ts"` to [frontend/package.json](frontend/package.json). Do not tighten budgets in 6-1B — that's 6-1C.
- **6-1C — baseline run + documented budgets + CI assertion.** Run `yarn benchmark:map` locally several times, document the realistic numbers in a Phase 6 budgets file (or extend `memory/execution_context.md` Phase 6 entry), tighten the in-spec defaults, then wire the benchmark into CI as a fail-on-regression check. Keep CI thresholds slightly looser than local baseline to absorb runner variance.
- Phase 7 (advanced geospatial tools — measurement, annotation, temporary overlays) remains unstarted and is intentionally sequenced after Phase 6.

## Currently Locked Files

- none

## Validation Commands

```bash
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run src/test/useMapBenchmarkBridge.test.ts src/test/useMapSignalLayersPerf.test.ts
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx vitest run
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx tsc -p tsconfig.app.json --noEmit
cd /Users/timurmishiev/Desktop/Code/resilience/frontend && npx eslint src/lib/perfInstrumentation.ts src/hooks/map/useMapSignalLayers.ts src/hooks/useMapBenchmarkBridge.ts src/components/map/types.ts src/pages/MapPage.tsx src/test/useMapBenchmarkBridge.test.ts src/test/useMapSignalLayersPerf.test.ts
git -C /Users/timurmishiev/Desktop/Code/resilience diff --check
```

## Last Validation Results (Phase 6 Slice 6-1A, 2026-04-19, pre-commit)

- Focused Vitest (`useMapBenchmarkBridge` + `useMapSignalLayersPerf`): **14 examples, 0 failures** (+14 new for 6-1A)
- Full Vitest suite: **590 tests across 82 files, 0 failures** (was 576/80 on 5-2C)
- TypeScript (`tsconfig.app.json`): **0 errors**
- ESLint on touched files: **0 issues**
- `git diff --check`: **clean**

## Known Risks / Blockers

- Backend local validation still needs the repo Ruby path:
  - `TEST_DATABASE_PORT=5434 /Users/timurmishiev/.rbenv/shims/bundle exec ...`
  - the system `bundle` path still fails on the known Bundler `2.7.2` mismatch
- Frontend type-check must continue using:
  - `npx tsc -p tsconfig.app.json --noEmit`
  - the loose root `tsc --noEmit` is not authoritative for this repo
- **`AlertChainDrawer` mount convention on `/map`.** Each of `MapSignalAlertsSection` and `MapSiteAlertsSection` mounts its own `AlertChainDrawer` instance with local state. Safe today because `MapSignalPanel` and `MapSitePanel` are mutually exclusive in `MapSelectionPanels` — only one is rendered at any time, so only one drawer exists in the tree. If a future slice mounts both panels simultaneously, or mounts `EvidenceDrawer` on `/map` (which itself nests an `AlertChainDrawer`), reconcile to a single coordinator at `MapPage` or `MapSelectionPanels` level. Same reconciliation note as 5-2A.
- Both sections already null-render during replay (`if (isReplaying) return null`). The Chain button therefore never appears in replay, which matches `AlertChainDrawer`'s existing design (never opened from a replay context). If a future surface renders alert rows during replay, the chain drawer's replay semantics need to be re-evaluated.
- **`AlertChainDrawer.referenceTimeMs` is opt-in.** Callers without a replay-aware clock (e.g. `AlertTriagePage`, `IncidentAlertsTab`, `SiteDetailPage`, `AlertsPanel`, `EvidenceDrawer`) intentionally omit the prop and get no stale-basis indicator. This is correct — the drawer must never wall-clock (`react-hooks/purity` forbids `Date.now()` in the component body, and replay correctness forbids it anyway). If a future surface wants the indicator, it must thread a real reference clock through.
- Evidence resolution is scoped to the `/api/recommendations` surface only. It does **not** widen any other API that happens to render raw `evidence` JSONB.
- Replay intentionally returns both `alert: null` and `label: null` for matches whose `fired_at > as_of`. Do not "helpfully" fall back to live state — that would leak future state into replay.
- Handoff never records the tip SHA — it would be self-referential with the commit that writes it. Product-commit SHAs live in "Shipped In This Phase"; run `git log -1` for the literal tip.

## Do Not Reopen

- Phase 0 — Execution Foundation
- Phase 1 — Trustworthy Operational Picture
- Phase 2 — Map workstation + triage-in-context
- Phase 3 — Spatial analytics + spatial trust rendering
- Phase 4 Slice 1 — debrief audit-events API prerequisites
- Phase 4 Slice 2 — debrief entry + meaningful-event timeline
- Phase 4 Slice 3 — click-to-reconstruct workflow
- Phase 4 Slices 4a + 4b — temporal diff + incident compare
- Phase 4 Slice 4c — site compare
- Phase 4 Slice 4c-followup — compare-tab hardening
- Phase 5 Slice 1 — incident alert evidence access
- Phase 5 Slice 2-A-full — recommendation evidence access
- Phase 5 Slice 2-A-followup — replay fired_at filter on alert evidence labels
- Phase 5 Slice 2-B — map alert evidence chain affordance
- Phase 5 Slice 2-C — stale-basis surfacing on alert evidence
- project-skill consolidation / deep-review removal / repo-managed `.claude/skills`
